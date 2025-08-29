import { type Context, Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "../utils/auth.ts";
import { getDB } from "../db/mod.ts";
import type { DirectMessageDoc } from "@takos/types";

const app = new Hono();
const auth = (c: Context, next: () => Promise<void>) =>
  authRequired(getDB(c))(c, next);
app.use("/dms/*", auth);

app.get("/dms", async (c) => {
  const owner = c.req.query("owner");
  if (!owner) return c.json({ error: "owner is required" }, 400);
  const db = getDB(c);
  const rooms = await db.dms.list(owner) as DirectMessageDoc[];
  const formatted = rooms.map((r) => ({ id: r.id, owner: r.owner }));
  return c.json(formatted);
});

app.post(
  "/dms",
  zValidator("json", z.object({ owner: z.string(), id: z.string() })),
  async (c) => {
    const { owner, id } = c.req.valid("json") as { owner: string; id: string };
    const db = getDB(c);
    const room = await db.dms.create({ owner, id });
    return c.json(room);
  },
);

// DM は保持情報が最小のため、更新エンドポイントは未対応
app.patch("/dms/:id", (c) => c.json({ error: "not supported" }, 400));

// DM はアイコンを保存しない
app.post("/dms/:id/icon", (c) => c.json({ error: "not supported" }, 400));

app.delete("/dms/:id", async (c) => {
  const owner = c.req.query("owner");
  if (!owner) return c.json({ error: "owner is required" }, 400);
  const id = c.req.param("id");
  const db = getDB(c);
  const ok = await db.dms.delete(owner, id);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ success: true });
});

export default app;
