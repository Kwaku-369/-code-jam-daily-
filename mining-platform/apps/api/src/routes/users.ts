import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { hashPassword } from "@mining/auth";
import { ok, fail } from "@mining/shared";
import { query, queryOne, execute, nowISO } from "../lib/db";
import { audit } from "../lib/audit";
import { authMiddleware, requireRole } from "../middleware/auth";
import type { AppEnv } from "../types";

const router = new Hono<AppEnv>();
router.use("*", authMiddleware);

// GET /users — list users in company
router.get("/", async (c) => {
  const user  = c.get("user");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20"), 100);
  const role  = c.req.query("role");

  const rows = await query<{
    id: string; email: string; display_name: string;
    role: string; employee_id: string; active: number; last_login_at: string;
  }>(c.env.DB,
    role
      ? `SELECT id,email,display_name,role,employee_id,active,last_login_at FROM users WHERE company_id=? AND role=? AND active=1 LIMIT ?`
      : `SELECT id,email,display_name,role,employee_id,active,last_login_at FROM users WHERE company_id=? AND active=1 LIMIT ?`,
    role ? [user.company_id, role, limit] : [user.company_id, limit],
  );

  return c.json(ok({ users: rows }));
});

// GET /users/:id
router.get("/:id", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();

  const row = await queryOne<{
    id: string; email: string; display_name: string; role: string;
    employee_id: string; totp_enabled: number; active: number; created_at: string;
  }>(c.env.DB,
    `SELECT id,email,display_name,role,employee_id,totp_enabled,active,created_at
     FROM users WHERE id=? AND company_id=?`,
    [id, user.company_id],
  );

  if (!row) return c.json(fail("User not found"), 404);
  return c.json(ok(row));
});

// PATCH /users/:id — update profile (own) or any user (admin)
router.patch("/:id",
  zValidator("json", z.object({
    display_name: z.string().min(2).max(80).optional(),
    employee_id:  z.string().optional(),
    role:         z.enum(["admin","instructor","analyst","worker"]).optional(),
    active:       z.boolean().optional(),
  })),
  async (c) => {
    const caller = c.get("user");
    const { id } = c.req.param();
    const body   = c.req.valid("json");
    const db     = c.env.DB;

    // Only admin+ can update others or change roles
    if (id !== caller.sub && caller.role !== "admin" && caller.role !== "super_admin") {
      return c.json(fail("Forbidden"), 403);
    }
    if ((body.role || body.active !== undefined) &&
        caller.role !== "admin" && caller.role !== "super_admin") {
      return c.json(fail("Only admins can change roles"), 403);
    }

    const target = await queryOne<{ id: string }>(db,
      `SELECT id FROM users WHERE id=? AND company_id=?`, [id, caller.company_id]);
    if (!target) return c.json(fail("User not found"), 404);

    const sets: string[] = ["updated_at=?"];
    const vals: (string | number | null)[] = [nowISO()];
    if (body.display_name) { sets.push("display_name=?"); vals.push(body.display_name); }
    if (body.employee_id)  { sets.push("employee_id=?");  vals.push(body.employee_id); }
    if (body.role)         { sets.push("role=?");          vals.push(body.role); }
    if (body.active !== undefined) { sets.push("active=?"); vals.push(body.active ? 1 : 0); }

    vals.push(id);
    await execute(db, `UPDATE users SET ${sets.join(",")} WHERE id=?`, vals as any);
    await audit(db, { company_id: caller.company_id, user_id: caller.sub, action: "USER_UPDATED", resource: "users", resource_id: id, payload: body });

    return c.json(ok({ updated: true }));
  },
);

// POST /users/:id/reset-password — admin resets another user's password
router.post("/:id/reset-password",
  requireRole("admin"),
  zValidator("json", z.object({ new_password: z.string().min(8).max(128) })),
  async (c) => {
    const caller = c.get("user");
    const { id } = c.req.param();
    const { new_password } = c.req.valid("json");
    const db = c.env.DB;

    const target = await queryOne<{ id: string }>(db, `SELECT id FROM users WHERE id=? AND company_id=?`, [id, caller.company_id]);
    if (!target) return c.json(fail("User not found"), 404);

    const hash = await hashPassword(new_password);
    await execute(db, `UPDATE users SET password_hash=?, updated_at=? WHERE id=?`, [hash, nowISO(), id]);
    // Revoke all refresh tokens for this user
    await execute(db, `UPDATE refresh_tokens SET revoked=1 WHERE user_id=?`, [id]);
    await audit(db, { company_id: caller.company_id, user_id: caller.sub, action: "PASSWORD_RESET", resource: "users", resource_id: id });

    return c.json(ok({ message: "Password reset. All sessions revoked." }));
  },
);

export default router;
