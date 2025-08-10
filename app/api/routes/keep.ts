import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "../utils/auth.ts";
import Memo from "../models/takos/memo.ts";

const app = new Hono();
app.use("/users/:user/keep*", authRequired);

app.get("/users/:user/keep", async (c) => {
  const user = c.req.param("user");
  const limit = Math.min(
    parseInt(c.req.query("limit") ?? "50", 10) || 50,
    100,
  );
  const before = c.req.query("before");
  const cond: Record<string, unknown> = { user };
  if (before) cond.createdAt = { $lt: new Date(before) };
  const list = await Memo.find(cond).sort({ createdAt: -1 }).limit(limit)
    .lean<{ _id: string; content: string; createdAt: Date }[]>();
  return c.json(list.map((d) => ({
    id: d._id,
    content: d.content,
    createdAt: d.createdAt,
  })));
});

app.post(
  "/users/:user/keep",
  zValidator("json", z.object({ content: z.string() })),
  async (c) => {
    const user = c.req.param("user");
    const { content } = c.req.valid("json") as { content: string };
    const doc = await Memo.create({ user, content, createdAt: new Date() });
    return c.json({
      id: String(doc._id),
      content: doc.content,
      createdAt: doc.createdAt,
    });
  },
);

export default app;
