import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "../utils/auth.ts";
import Memo from "../models/takos/memo.ts";

const app = new Hono();
app.use("/users/:user/keep*", authRequired);

// 既存: ユーザー別の Keep 一覧取得（テキスト＋添付対応）
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
    .lean<{
      _id: string;
      content: string;
      attachments?: unknown[];
      createdAt: Date;
    }[]>();
  return c.json(list.map((d) => ({
    id: d._id,
    content: d.content,
    attachments: Array.isArray(d.attachments) ? d.attachments : [],
    createdAt: d.createdAt,
  })));
});

// 既存: Keep への保存（テキスト＋添付対応）
app.post(
  "/users/:user/keep",
  zValidator(
    "json",
    z.object({
      content: z.string().optional(),
      attachments: z.array(z.unknown()).optional(),
    }),
  ),
  async (c) => {
    const user = c.req.param("user");
    const { content, attachments } = c.req.valid("json") as {
      content?: string;
      attachments?: unknown[];
    };
    // content か attachments の少なくとも一方が必要
    if (!content && !(Array.isArray(attachments) && attachments.length > 0)) {
      return c.json({ error: "content or attachments required" }, 400);
    }
    const doc = await Memo.create({
      user,
      content: content ?? "",
      attachments: Array.isArray(attachments) ? attachments : [],
      createdAt: new Date(),
    });
    return c.json({
      id: String(doc._id),
      content: doc.content,
      attachments: Array.isArray(doc.attachments) ? doc.attachments : [],
      createdAt: doc.createdAt,
    });
  },
);

// 新規: クライアント実装が参照する /api/keeps のエイリアス
// ?handle=<user@domain> を受け取り、ローカルユーザー名に解決して処理
app.use("/keeps*", authRequired);

app.get("/keeps", async (c) => {
  const handle = c.req.query("handle");
  if (!handle) return c.json({ error: "handle is required" }, 400);
  const name = handle.includes("@") ? handle.split("@")[0] : handle;
  // /users/:user/keep と同じ処理
  const limit = Math.min(
    parseInt(c.req.query("limit") ?? "50", 10) || 50,
    100,
  );
  const before = c.req.query("before");
  const cond: Record<string, unknown> = { user: name };
  if (before) cond.createdAt = { $lt: new Date(before) };
  const list = await Memo.find(cond).sort({ createdAt: -1 }).limit(limit)
    .lean<{
      _id: string;
      content: string;
      attachments?: unknown[];
      createdAt: Date;
    }[]>();
  return c.json(list.map((d) => ({
    id: d._id,
    content: d.content,
    attachments: Array.isArray(d.attachments) ? d.attachments : [],
    createdAt: d.createdAt,
  })));
});

app.post(
  "/keeps",
  zValidator(
    "json",
    z.object({
      handle: z.string(),
      content: z.string().optional(),
      attachments: z.array(z.unknown()).optional(),
    }),
  ),
  async (c) => {
    const { handle, content, attachments } = c.req.valid("json") as {
      handle: string;
      content?: string;
      attachments?: unknown[];
    };
    const name = handle.includes("@") ? handle.split("@")[0] : handle;
    if (!content && !(Array.isArray(attachments) && attachments.length > 0)) {
      return c.json({ error: "content or attachments required" }, 400);
    }
    const doc = await Memo.create({
      user: name,
      content: content ?? "",
      attachments: Array.isArray(attachments) ? attachments : [],
      createdAt: new Date(),
    });
    return c.json({
      id: String(doc._id),
      content: doc.content,
      attachments: Array.isArray(doc.attachments) ? doc.attachments : [],
      createdAt: doc.createdAt,
    });
  },
);

export default app;
