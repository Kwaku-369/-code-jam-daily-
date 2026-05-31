import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { ok, fail } from "@mining/shared";
import { query, queryOne, execute, newId, nowISO } from "../lib/db";
import { audit } from "../lib/audit";
import { authMiddleware, requireRole } from "../middleware/auth";
import type { AppEnv } from "../types";

const router = new Hono<AppEnv>();
router.use("*", authMiddleware);

router.get("/", async (c) => {
  const user   = c.get("user");
  const status = c.req.query("status");
  const rows   = await query<{
    id: string; name: string; latitude: number; longitude: number;
    status: string; ore_type: string; created_at: string;
  }>(c.env.DB,
    status
      ? `SELECT id,name,latitude,longitude,status,ore_type,created_at FROM sites WHERE company_id=? AND status=?`
      : `SELECT id,name,latitude,longitude,status,ore_type,created_at FROM sites WHERE company_id=?`,
    status ? [user.company_id, status] : [user.company_id],
  );
  return c.json(ok({ sites: rows }));
});

router.get("/:id", async (c) => {
  const user = c.get("user");
  const row  = await queryOne<object>(c.env.DB,
    `SELECT * FROM sites WHERE id=? AND company_id=?`, [c.req.param("id"), user.company_id]);
  if (!row) return c.json(fail("Site not found"), 404);
  return c.json(ok(row));
});

router.post("/",
  requireRole("admin"),
  zValidator("json", z.object({
    name:        z.string().min(2).max(120),
    latitude:    z.number().min(-90).max(90),
    longitude:   z.number().min(-180).max(180),
    elevation_m: z.number().optional(),
    ore_type:    z.string().min(1),
    concession:  z.string().optional(),
    status:      z.enum(["active","exploration"]).default("active"),
  })),
  async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    const id   = newId();
    const now  = nowISO();

    await execute(c.env.DB,
      `INSERT INTO sites (id,company_id,name,latitude,longitude,elevation_m,status,ore_type,concession,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, user.company_id, body.name, body.latitude, body.longitude,
       body.elevation_m ?? null, body.status, body.ore_type, body.concession ?? null,
       user.sub, now, now],
    );
    await audit(c.env.DB, { company_id: user.company_id, user_id: user.sub, action: "SITE_CREATED", resource: "sites", resource_id: id });
    return c.json(ok({ id }), 201);
  },
);

router.patch("/:id",
  requireRole("admin"),
  zValidator("json", z.object({
    name:     z.string().optional(),
    status:   z.enum(["active","suspended","closed","exploration"]).optional(),
    ore_type: z.string().optional(),
  })),
  async (c) => {
    const user  = c.get("user");
    const { id } = c.req.param();
    const body  = c.req.valid("json");

    const sets: string[] = ["updated_at=?"];
    const vals: (string | null)[] = [nowISO()];
    if (body.name)     { sets.push("name=?");     vals.push(body.name); }
    if (body.status)   { sets.push("status=?");   vals.push(body.status); }
    if (body.ore_type) { sets.push("ore_type=?"); vals.push(body.ore_type); }
    vals.push(id, user.company_id);

    const res = await execute(c.env.DB, `UPDATE sites SET ${sets.join(",")} WHERE id=? AND company_id=?`, vals as any);
    if (!res.meta?.changes) return c.json(fail("Site not found"), 404);
    await audit(c.env.DB, { company_id: user.company_id, user_id: user.sub, action: "SITE_UPDATED", resource: "sites", resource_id: id });
    return c.json(ok({ updated: true }));
  },
);

export default router;
