/**
 * Cloudflare Queue Consumer — AI Job Processing
 * Pattern: Async task offload + Outbox notification
 *
 * Job types:
 *   GENERATE_SAFETY_BRIEF — LLM generates pre-shift safety briefing
 *   ANALYZE_INCIDENT      — LLM root-cause analysis for safety incidents
 *   SUMMARIZE_REPORT      — LLM production summary for shift reports
 *   SUMMARIZE_SHIFT       — LLM shift summary when job completes
 */

import type { Env } from "../types";

export type AIJob =
  | { type: "GENERATE_SAFETY_BRIEF"; jobId: string; title: string; description: string; shiftType: string; companyId: string }
  | { type: "ANALYZE_INCIDENT"; incidentId: string; severity: string; description: string; companyId: string }
  | { type: "SUMMARIZE_REPORT"; reportId: string; ore_extracted: number; hours_worked: number; notes: string; companyId: string }
  | { type: "SUMMARIZE_SHIFT"; jobId: string; companyId: string };

export async function handleQueue(batch: MessageBatch<AIJob>, env: Env): Promise<void> {
  await Promise.allSettled(batch.messages.map(msg => processMessage(msg.body, env)));
}

async function processMessage(job: AIJob, env: Env): Promise<void> {
  switch (job.type) {
    case "GENERATE_SAFETY_BRIEF":
      await generateSafetyBrief(job, env);
      break;
    case "ANALYZE_INCIDENT":
      await analyzeIncident(job, env);
      break;
    case "SUMMARIZE_REPORT":
      await summarizeReport(job, env);
      break;
    case "SUMMARIZE_SHIFT":
      await summarizeShift(job, env);
      break;
  }
}

// ── Claude API helper ─────────────────────────────────────────────────────────

async function callClaude(apiKey: string, prompt: string, system: string, maxTokens = 500): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",  // fast + cheap for async tasks
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return data.content.find(b => b.type === "text")?.text ?? "";
}

// ── Safety Brief ──────────────────────────────────────────────────────────────

async function generateSafetyBrief(
  job: Extract<AIJob, { type: "GENERATE_SAFETY_BRIEF" }>,
  env: Env,
): Promise<void> {
  const brief = await callClaude(
    env.ANTHROPIC_API_KEY,
    `Generate a concise safety briefing for this mining shift:
Title: ${job.title}
Shift: ${job.shiftType}
Description: ${job.description}

Include: hazard identification, PPE requirements, emergency procedures, key safety checks.
Format as bullet points. Keep it practical and under 400 words.`,
    "You are a mining safety officer. Generate clear, actionable safety briefings.",
    600,
  );

  const flags = extractSafetyFlags(brief);
  const now   = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE jobs SET ai_brief=?, safety_flags=?, updated_at=? WHERE id=?`,
  ).bind(brief, JSON.stringify(flags), now, job.jobId).run();

  // Notify instructor
  const jobRow = await env.DB.prepare(
    `SELECT instructor_id FROM jobs WHERE id=?`,
  ).bind(job.jobId).first<{ instructor_id: string }>();

  if (jobRow) {
    await env.DB.prepare(`
      INSERT INTO notifications (id,user_id,company_id,type,title,message,data,read,created_at)
      VALUES (?,?,?,'SAFETY_BRIEF_READY','Safety Brief Ready','AI safety brief is available for your shift.',?,0,?)
    `).bind(crypto.randomUUID(), jobRow.instructor_id, job.companyId, JSON.stringify({ jobId: job.jobId }), now).run();
  }
}

// ── Incident Analysis ─────────────────────────────────────────────────────────

async function analyzeIncident(
  job: Extract<AIJob, { type: "ANALYZE_INCIDENT" }>,
  env: Env,
): Promise<void> {
  const analysis = await callClaude(
    env.ANTHROPIC_API_KEY,
    `Analyze this mining safety incident:
Severity: ${job.severity}
Description: ${job.description}

Provide: root cause analysis, contributing factors, immediate actions required, corrective measures, similar risks to watch for.`,
    "You are a mining safety investigator. Provide thorough, actionable incident analysis.",
    800,
  );

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE incidents SET ai_analysis=?, status='investigating', updated_at=? WHERE id=?`,
  ).bind(analysis, now, job.incidentId).run();
}

// ── Production Report Summary ─────────────────────────────────────────────────

async function summarizeReport(
  job: Extract<AIJob, { type: "SUMMARIZE_REPORT" }>,
  env: Env,
): Promise<void> {
  const summary = await callClaude(
    env.ANTHROPIC_API_KEY,
    `Summarize this mining production report:
Ore extracted: ${job.ore_extracted} tonnes
Hours worked: ${job.hours_worked}h
Notes: ${job.notes}

Provide: performance assessment, productivity rate (tonnes/hour), observations, recommendations.`,
    "You are a mining operations analyst. Be concise and data-driven.",
    400,
  );

  await env.DB.prepare(
    `UPDATE production_reports SET ai_summary=? WHERE id=?`,
  ).bind(summary, job.reportId).run();
}

// ── Shift Summary ─────────────────────────────────────────────────────────────

async function summarizeShift(
  job: Extract<AIJob, { type: "SUMMARIZE_SHIFT" }>,
  env: Env,
): Promise<void> {
  const reports = await env.DB.prepare(
    `SELECT ore_extracted,hours_worked,grade,recovery_rate FROM production_reports WHERE job_id=?`,
  ).bind(job.jobId).all<{ ore_extracted: number; hours_worked: number; grade: number; recovery_rate: number }>();

  if (!reports.results.length) return;

  const totals = reports.results.reduce(
    (acc, r) => ({ ore: acc.ore + r.ore_extracted, hours: acc.hours + r.hours_worked }),
    { ore: 0, hours: 0 },
  );

  const summary = await callClaude(
    env.ANTHROPIC_API_KEY,
    `Summarize completed mining shift:
Total ore: ${totals.ore.toFixed(2)} tonnes
Total hours: ${totals.hours.toFixed(1)}h
Reports filed: ${reports.results.length}

Provide a 2-sentence executive summary and key highlights.`,
    "You are a mining operations analyst.",
    300,
  );

  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE jobs SET ai_brief=COALESCE(ai_brief,'')||'\n\n--- Shift Summary ---\n'||?, updated_at=? WHERE id=?`,
  ).bind(summary, now, job.jobId).run();
}

// ── Safety Flag Extractor ─────────────────────────────────────────────────────
// Simple heuristic — extract hazard keywords from AI brief

function extractSafetyFlags(text: string): string[] {
  const hazards = [
    "explosion","fire","toxic","gas","electrical","fall","crush","flood",
    "rockfall","dust","noise","vibration","chemical","radiation","heat","cold",
  ];
  const lower = text.toLowerCase();
  return hazards.filter(h => lower.includes(h));
}
