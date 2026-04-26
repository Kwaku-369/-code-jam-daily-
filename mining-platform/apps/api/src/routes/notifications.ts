import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { ok } from "@mining/shared";
import { NotificationService } from "@mining/notifications";
import { authMiddleware } from "../middleware/auth";
import type { AppEnv } from "../types";

const router = new Hono<AppEnv>();
router.use("*", authMiddleware);

router.get("/", async (c) => {
  const user   = c.get("user");
  const limit  = Math.min(parseInt(c.req.query("limit") ?? "50"), 100);
  const offset = parseInt(c.req.query("offset") ?? "0");
  const svc    = new NotificationService(c.env.DB);

  const { notifications, unread_count } = await svc.getAll(user.sub, limit, offset);
  const wallet = await svc.getWalletSummary(user.sub);

  return c.json(ok({ notifications, unread_count, wallet }));
});

router.patch("/:id/read", async (c) => {
  const user = c.get("user");
  await new NotificationService(c.env.DB).markRead(c.req.param("id"), user.sub);
  return c.json(ok({ marked: true }));
});

router.post("/read-all", async (c) => {
  const user = c.get("user");
  await new NotificationService(c.env.DB).markAllRead(user.sub);
  return c.json(ok({ marked: true }));
});

export default router;
