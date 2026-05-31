/**
 * Auth Middleware — JWT verification + RBAC
 * Applies: Role Hierarchy from shared package (super_admin > admin > instructor > analyst > worker)
 */

import { createMiddleware } from "hono/factory";
import { verifyJWT } from "@mining/auth";
import { hasMinRole } from "@mining/shared";
import type { Role } from "@mining/shared";
import type { AppEnv } from "../types";

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ ok: false, error: "Missing auth token" }, 401);
  }
  try {
    const payload = await verifyJWT(auth.slice(7), c.env.JWT_SECRET);
    if (payload.type !== "access") return c.json({ ok: false, error: "Invalid token type" }, 401);
    c.set("user", payload);
    await next();
  } catch {
    return c.json({ ok: false, error: "Invalid or expired token" }, 401);
  }
});

export function requireRole(minRole: Role) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user) return c.json({ ok: false, error: "Unauthorized" }, 401);
    if (!hasMinRole(user.role as Role, minRole)) {
      return c.json({ ok: false, error: `Requires role: ${minRole}` }, 403);
    }
    await next();
  });
}

// Verify request is for same company (multi-tenant guard)
export function sameCompany() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user       = c.get("user");
    const paramComp  = c.req.param("company_id");
    if (paramComp && paramComp !== user.company_id && user.role !== "super_admin") {
      return c.json({ ok: false, error: "Forbidden" }, 403);
    }
    await next();
  });
}
