// ─── Shared types, constants, and utilities ───────────────────────────────

// ---- Roles ---------------------------------------------------------------

export const ROLES = {
  SUPER_ADMIN:  "super_admin",   // platform owner / developer
  ADMIN:        "admin",         // mining company admin
  INSTRUCTOR:   "instructor",    // shift supervisor / trainer
  WORKER:       "worker",        // miner / field worker
  ANALYST:      "analyst",       // data / safety analyst
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

export const ROLE_HIERARCHY: Record<Role, number> = {
  super_admin: 100,
  admin:        80,
  instructor:   60,
  analyst:      50,
  worker:       20,
};

export function hasMinRole(userRole: Role, required: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[required];
}

// ---- API response envelope -----------------------------------------------

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?:   T;
  error?:  string;
  code?:   string;   // machine-readable error code
  meta?:   { page?: number; total?: number; limit?: number };
}

export function ok<T>(data: T, meta?: ApiResponse["meta"]): ApiResponse<T> {
  return { success: true, data, ...(meta ? { meta } : {}) };
}

export function fail(error: string, code?: string): ApiResponse<never> {
  return { success: false, error, ...(code ? { code } : {}) };
}

// ---- Pagination ----------------------------------------------------------

export interface PaginationQuery {
  page:  number;
  limit: number;
}

export function paginate(query: Partial<PaginationQuery>): PaginationQuery {
  return {
    page:  Math.max(1, Number(query.page)  || 1),
    limit: Math.min(100, Number(query.limit) || 20),
  };
}

export function paginationOffset(p: PaginationQuery): number {
  return (p.page - 1) * p.limit;
}

// ---- Common value objects ------------------------------------------------

export interface Coordinates {
  lat:  number;
  lng:  number;
  elevation_m?: number;
}

export type MineStatus = "active" | "suspended" | "closed" | "exploration";
export type JobStatus  = "draft" | "scheduled" | "in_progress" | "completed" | "cancelled";
export type ShiftType  = "day" | "night" | "swing";

// ---- Audit fields --------------------------------------------------------

export interface Auditable {
  created_at: string;  // ISO-8601
  updated_at: string;
  created_by: string;  // user_id
}

// ---- Error codes ---------------------------------------------------------

export const ERROR_CODES = {
  UNAUTHORIZED:     "UNAUTHORIZED",
  FORBIDDEN:        "FORBIDDEN",
  NOT_FOUND:        "NOT_FOUND",
  VALIDATION:       "VALIDATION",
  CONFLICT:         "CONFLICT",
  TOTP_REQUIRED:    "TOTP_REQUIRED",
  TOTP_INVALID:     "TOTP_INVALID",
  RATE_LIMITED:     "RATE_LIMITED",
  INTERNAL:         "INTERNAL",
} as const;
