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
  const user     = c.get("user");
  const severity = c.req.query("severity");
  const status   = c.req.query("status");
  const siteId   = c.req.query("site_id");

  let sql = `SELECT i.*,u.display_name as reporter_name,s.name as site_name
             FROM incidents i JOIN users u ON i.reported_by=u.id JOIN sites s ON i.site_id=s.id
             WHERE i.company_id=?`;
  const params: string[] = [user.company_id];
  if (severity) { sql += " AND i.severity=?"; params.push(severity); }
  if (status)   { sql += " AND i.status=?";   params.push(status); }
  if (siteId)   { sql += " AND i.site_id=?";  params.push(siteId); }
  sql += " ORDER BY i.created_at DESC LIMIT 50";

  return c.json(ok({ incidents: await query<object>(c.env.DB, sql, params) }));
});

router.get("/:id", async (c) => {
  const user = c.get("user");
  const row  = await queryOne<object>(c.env.DB,
    `SELECT i.*,u.display_name as reporter_name,s.name as site_name
     FROM incidents i JOIN users u ON i.reported_by=u.id JOIN sites s ON i.site_id=s.id
     WHERE i.id=? AND i.company_id=?`, [c.req.param("id"), user.company_id]);
  if (!row) return c.json(fail("Incident not found"), 404);
  return c.json(ok(row));
});

router.post("/",
  zValidator("json", z.object({
    site_id:     z.string().uuid(),
    severity:    z.enum(["low","medium","high","critical"]),
    description: z.string().min(10).max(2000),
  })),
  async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    const db   = c.env.DB;

    const site = await queryOne<{ id: string }>(db, `SELECT id FROM sites WHERE id=? AND company_id=?`, [body.site_id, user.company_id]);
    if (!site) return c.json(fail("Site not found"), 404);

    const id  = newId();
    const now = nowISO();

    await execute(db,
      `INSERT INTO incidents (id,site_id,company_id,reported_by,severity,description,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,'open',?,?)`,
      [id, body.site_id, user.company_id, user.sub, body.severity, body.description, now, now],
    );

    // Queue AI root-cause analysis
    await c.env.AI_QUEUE.send({
      type: "ANALYZE_INCIDENT",
      incidentId: id,
      severity: body.severity,
      description: body.description,
      companyId: user.company_id,
    });

    await audit(db, { company_id: user.company_id, user_id: user.sub, action: "INCIDENT_REPORTED", resource: "incidents", resource_id: id, payload: { severity: body.severity } });
    return c.json(ok({ id, status: "open", ai_analysis_pending: true }), 201);
  },
);

router.patch("/:id/resolve",
  requireRole("instructor"),
  zValidator("json", z.object({ resolution_notes: z.string().min(5) })),
  async (c) => {
    const user   = c.get("user");
    const { id } = c.req.param();
    const { resolution_notes } = c.req.valid("json");
    const db     = c.env.DB;
    const now    = nowISO();

    const res = await execute(db,
      `UPDATE incidents SET status='resolved',resolved_at=?,description=description||'\n\nResolution: '||?,updated_at=? WHERE id=? AND company_id=?`,
      [now, resolution_notes, now, id, user.company_id],
    );
    if (!res.meta?.changes) return c.json(fail("Incident not found"), 404);
    await audit(db, { company_id: user.company_id, user_id: user.sub, action: "INCIDENT_RESOLVED", resource: "incidents", resource_id: id });
    return c.json(ok({ resolved: true }));
  },
);

export default router;
