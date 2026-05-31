import { execute, newId, nowISO } from "./db";

export async function audit(
  db: D1Database,
  params: {
    company_id: string;
    user_id?: string;
    action: string;
    resource: string;
    resource_id?: string;
    ip_address?: string;
    user_agent?: string;
    payload?: unknown;
  },
): Promise<void> {
  await execute(db,
    `INSERT INTO audit_log (id,company_id,user_id,action,resource,resource_id,ip_address,user_agent,payload,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      newId(),
      params.company_id,
      params.user_id ?? null,
      params.action,
      params.resource,
      params.resource_id ?? null,
      params.ip_address ?? null,
      params.user_agent ?? null,
      params.payload ? JSON.stringify(params.payload) : null,
      nowISO(),
    ],
  );
}
