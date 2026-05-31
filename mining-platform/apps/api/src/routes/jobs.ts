/**
 * Jobs Routes
 * AI brief generation is async via Queue (pattern: async task offload)
 */

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
  const siteId = c.req.query("site_id");

  let sql    = `SELECT j.id,j.title,j.shift_type,j.status,j.scheduled_at,j.instructor_id,u.display_name as instructor_name,j.site_id,s.name as site_name
                FROM jobs j JOIN users u ON j.instructor_id=u.id JOIN sites s ON j.site_id=s.id
                WHERE j.company_id=?`;
  const params: (string | null)[] = [user.company_id];

  if (status)  { sql += " AND j.status=?"; params.push(status); }
  if (siteId)  { sql += " AND j.site_id=?"; params.push(siteId); }
  if (user.role === "worker") {
    sql += ` AND j.id IN (SELECT job_id FROM job_assignments WHERE user_id=?)`;
    params.push(user.sub);
  }
  sql += " ORDER BY j.scheduled_at DESC LIMIT 50";

  const rows = await query<object>(c.env.DB, sql, params as any);
  return c.json(ok({ jobs: rows }));
});

router.get("/:id", async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();

  const job = await queryOne<object>(c.env.DB,
    `SELECT j.*,u.display_name as instructor_name,s.name as site_name
     FROM jobs j JOIN users u ON j.instructor_id=u.id JOIN sites s ON j.site_id=s.id
     WHERE j.id=? AND j.company_id=?`, [id, user.company_id]);
  if (!job) return c.json(fail("Job not found"), 404);

  const assignments = await query<{ user_id: string; display_name: string; role: string }>(
    c.env.DB,
    `SELECT ja.user_id, u.display_name, u.role FROM job_assignments ja
     JOIN users u ON ja.user_id=u.id WHERE ja.job_id=?`, [id],
  );

  return c.json(ok({ ...job as object, assignments }));
});

router.post("/",
  requireRole("instructor"),
  zValidator("json", z.object({
    site_id:       z.string().uuid(),
    title:         z.string().min(3).max(200),
    description:   z.string().default(""),
    shift_type:    z.enum(["day","night","swing"]),
    instructor_id: z.string().uuid().optional(),
    scheduled_at:  z.string().datetime(),
    worker_ids:    z.array(z.string().uuid()).default([]),
  })),
  async (c) => {
    const user  = c.get("user");
    const body  = c.req.valid("json");
    const db    = c.env.DB;
    const id    = newId();
    const now   = nowISO();
    const instrId = body.instructor_id ?? user.sub;

    // Verify site belongs to company
    const site = await queryOne<{ id: string }>(db, `SELECT id FROM sites WHERE id=? AND company_id=?`, [body.site_id, user.company_id]);
    if (!site) return c.json(fail("Site not found"), 404);

    const stmts = [
      db.prepare(`
        INSERT INTO jobs (id,site_id,company_id,title,description,shift_type,status,instructor_id,scheduled_at,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'scheduled',?,?,?,?,?)
      `).bind(id, body.site_id, user.company_id, body.title, body.description, body.shift_type, instrId, body.scheduled_at, user.sub, now, now),
    ];

    for (const workerId of body.worker_ids) {
      stmts.push(
        db.prepare(`INSERT INTO job_assignments (job_id,user_id,assigned_at) VALUES (?,?,?) ON CONFLICT DO NOTHING`)
          .bind(id, workerId, now),
      );
    }

    await db.batch(stmts);

    // Queue AI safety brief generation (async — won't block response)
    await c.env.AI_QUEUE.send({
      type: "GENERATE_SAFETY_BRIEF",
      jobId: id,
      title: body.title,
      description: body.description,
      shiftType: body.shift_type,
      companyId: user.company_id,
    });

    await audit(db, { company_id: user.company_id, user_id: user.sub, action: "JOB_CREATED", resource: "jobs", resource_id: id });
    return c.json(ok({ id, status: "scheduled", ai_brief: null, ai_brief_pending: true }), 201);
  },
);

router.patch("/:id/status",
  requireRole("instructor"),
  zValidator("json", z.object({
    status: z.enum(["in_progress","completed","cancelled"]),
  })),
  async (c) => {
    const user   = c.get("user");
    const { id } = c.req.param();
    const { status } = c.req.valid("json");
    const db     = c.env.DB;
    const now    = nowISO();

    const extra = status === "completed" ? ", completed_at=?" : "";
    const params: (string | null)[] = status === "completed"
      ? [status, now, now, id, user.company_id]
      : [status, now, id, user.company_id];

    const res = await execute(db,
      `UPDATE jobs SET status=?${extra}, updated_at=? WHERE id=? AND company_id=?`, params as any);
    if (!res.meta?.changes) return c.json(fail("Job not found"), 404);

    if (status === "completed") {
      // Trigger production report summary via AI queue
      await c.env.AI_QUEUE.send({ type: "SUMMARIZE_SHIFT", jobId: id, companyId: user.company_id });
    }

    await audit(db, { company_id: user.company_id, user_id: user.sub, action: `JOB_${status.toUpperCase()}`, resource: "jobs", resource_id: id });
    return c.json(ok({ updated: true, status }));
  },
);

// Assign additional workers
router.post("/:id/assign",
  requireRole("instructor"),
  zValidator("json", z.object({ worker_ids: z.array(z.string().uuid()).min(1) })),
  async (c) => {
    const user   = c.get("user");
    const { id } = c.req.param();
    const { worker_ids } = c.req.valid("json");
    const db     = c.env.DB;
    const now    = nowISO();

    const job = await queryOne<{ id: string }>(db, `SELECT id FROM jobs WHERE id=? AND company_id=?`, [id, user.company_id]);
    if (!job) return c.json(fail("Job not found"), 404);

    const stmts = worker_ids.map(wid =>
      db.prepare(`INSERT INTO job_assignments (job_id,user_id,assigned_at) VALUES (?,?,?) ON CONFLICT DO NOTHING`).bind(id, wid, now),
    );
    await db.batch(stmts);

    return c.json(ok({ assigned: worker_ids.length }));
  },
);

export default router;
