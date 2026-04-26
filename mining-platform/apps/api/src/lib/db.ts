/**
 * D1 Query Helpers — thin wrappers with type inference
 */

export async function query<T>(
  db: D1Database,
  sql: string,
  params: (string | number | null | boolean)[] = [],
): Promise<T[]> {
  const stmt = db.prepare(sql);
  const { results } = params.length ? await stmt.bind(...params).all<T>() : await stmt.all<T>();
  return results;
}

export async function queryOne<T>(
  db: D1Database,
  sql: string,
  params: (string | number | null | boolean)[] = [],
): Promise<T | null> {
  const stmt = db.prepare(sql);
  return params.length ? stmt.bind(...params).first<T>() : stmt.first<T>();
}

export async function execute(
  db: D1Database,
  sql: string,
  params: (string | number | null | boolean)[] = [],
): Promise<D1Result> {
  const stmt = db.prepare(sql);
  return params.length ? stmt.bind(...params).run() : stmt.run();
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowISO(): string {
  return new Date().toISOString();
}
