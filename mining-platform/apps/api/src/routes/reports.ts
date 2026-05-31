import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { ok, fail } from "@mining/shared";
import { query, queryOne, execute, newId, nowISO } from "../lib/db";
import { audit } from "../lib/audit";
import { authMiddleware } from "../middleware/auth";
import type { AppEnv } from "../types";

const router = new Hono<AppEnv>();
router.use("*", authMiddleware);

router.get("/", async (c) => {
  const user   = c.get("user");
  const siteId = c.req.query("site_id");
  const jobId  = c.req.query("job_id");

  let sql = `SELECT r.*,u.display_name as submitter_name,s.name as site_name
             FROM production_reports r JOIN users u ON r.submitted_by=u.id JOIN sites s ON r.site_id=s.id
             WHERE r.company_id=?`;
  const params: string[] = [user.company_id];
  if (siteId) { sql += " AND r.site_id=?"; params.push(siteId); }
  if (jobId)  { sql += " AND r.job_id=?";  params.push(jobId); }
  sql += " ORDER BY r.created_at DESC LIMIT 50";

  return c.json(ok({ reports: await query<object>(c.env.DB, sql, params) }));
});

router.get("/:id", async (c) => {
  const user = c.get("user");
  const row  = await queryOne<object>(c.env.DB,
    `SELECT r.*,u.display_name as submitter_name FROM production_reports r JOIN users u ON r.submitted_by=u.id WHERE r.id=? AND r.company_id=?`,
    [c.req.param("id"), user.company_id],
  );
  if (!row) return c.json(fail("Report not found"), 404);
  return c.json(ok(row));
});

router.post("/",
  zValidator("json", z.object({
    job_id:        z.string().uuid(),
    ore_extracted: z.number().min(0),
    grade:         z.number().optional(),
    recovery_rate: z.number().min(0).max(100).optional(),
    hours_worked:  z.number().min(0).max(24),
    equipment_used: z.array(z.string()).default([]),
    notes:         z.string().default(""),
  })),
  async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    const db   = c.env.DB;

    const job = await queryOne<{ id: string; site_id: string }>(db,
      `SELECT id, site_id FROM jobs WHERE id=? AND company_id=?`, [body.job_id, user.company_id]);
    if (!job) return c.json(fail("Job not found"), 404);

    const id  = newId();
    const now = nowISO();

    await execute(db,
      `INSERT INTO production_reports (id,job_id,site_id,company_id,submitted_by,ore_extracted,grade,recovery_rate,hours_worked,equipment_used,notes,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, body.job_id, job.site_id, user.company_id, user.sub,
       body.ore_extracted, body.grade ?? null, body.recovery_rate ?? null,
       body.hours_worked, JSON.stringify(body.equipment_used), body.notes, now],
    );

    // Queue AI summary generation
    await c.env.AI_QUEUE.send({
      type: "SUMMARIZE_REPORT",
      reportId: id,
      ore_extracted: body.ore_extracted,
      hours_worked: body.hours_worked,
      notes: body.notes,
      companyId: user.company_id,
    });

    await audit(db, { company_id: user.company_id, user_id: user.sub, action: "REPORT_SUBMITTED", resource: "production_reports", resource_id: id });
    return c.json(ok({ id, ai_summary_pending: true }), 201);
  },
);

// Analytics — site aggregate
router.get("/analytics/site/:siteId", async (c) => {
  const user = c.get("user");
  const { siteId } = c.req.param();

  const stats = await queryOne<{
    total_reports: number; total_ore: number;
    avg_grade: number; avg_recovery: number; total_hours: number;
  }>(c.env.DB,
    `SELECT COUNT(*) as total_reports, ROUND(SUM(ore_extracted),2) as total_ore,
            ROUND(AVG(grade),3) as avg_grade, ROUND(AVG(recovery_rate),2) as avg_recovery,
            ROUND(SUM(hours_worked),1) as total_hours
     FROM production_reports WHERE site_id=? AND company_id=?`,
    [siteId, user.company_id],
  );

  return c.json(ok(stats ?? {}));
});

export default router;
