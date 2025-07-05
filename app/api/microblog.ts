import { Hono } from "hono";
import Microblog from "./models/microblog.ts";
import Account from "./models/account.ts";
import { env } from "./utils/env.ts";

const app = new Hono();

app.get("/microblog", async (c) => {
  const list = await Microblog.find().sort({ createdAt: -1 }).lean();
  const formatted = await Promise.all(list.map(async (doc: Record<string, unknown>) => {
    const account = await Account.findOne({ userName: doc.author }).lean();
    return {
      id:
        typeof doc._id === "string"
          ? doc._id
          : typeof doc._id === "object" && doc._id !== null && "toString" in doc._id
          ? (doc._id as { toString: () => string }).toString()
          : "",
      userName: doc.author,
      displayName: account?.displayName || doc.author,
      authorAvatar: account?.avatarInitial || "",
      content: doc.content,
      createdAt: doc.createdAt,
      domain: env.ACTIVITYPUB_DOMAIN,
    };
  }));
  return c.json(formatted);
});

app.post("/microblog", async (c) => {
  const { author, content } = await c.req.json();
  if (typeof author !== "string" || typeof content !== "string") {
    return c.json({ error: "Invalid body" }, 400);
  }
  const post = new Microblog({ author, content });
  await post.save();
  const account = await Account.findOne({ userName: post.author }).lean();
  return c.json({
    id: post._id.toString(),
    userName: post.author,
    displayName: account?.displayName || post.author,
    authorAvatar: account?.avatarInitial || "",
    content: post.content,
    createdAt: post.createdAt,
    domain: env.ACTIVITYPUB_DOMAIN,
  }, 201);
});

app.get("/microblog/:id", async (c) => {
  const id = c.req.param("id");
  const post = await Microblog.findById(id).lean();
  if (!post) return c.json({ error: "Not found" }, 404);
  const account = await Account.findOne({ userName: post.author }).lean();
  return c.json({
    id: post._id.toString(),
    userName: post.author,
    displayName: account?.displayName || post.author,
    authorAvatar: account?.avatarInitial || "",
    content: post.content,
    createdAt: post.createdAt,
    domain: env.ACTIVITYPUB_DOMAIN,
  });
});

app.put("/microblog/:id", async (c) => {
  const id = c.req.param("id");
  const { content } = await c.req.json();
  if (typeof content !== "string") {
    return c.json({ error: "Invalid body" }, 400);
  }
  const post = await Microblog.findByIdAndUpdate(id, { content }, {
    new: true,
  });
  if (!post) return c.json({ error: "Not found" }, 404);
  const account = await Account.findOne({ userName: post.author }).lean();
  return c.json({
    id: post._id.toString(),
    userName: post.author,
    displayName: account?.displayName || post.author,
    authorAvatar: account?.avatarInitial || "",
    content: post.content,
    createdAt: post.createdAt,
    domain: env.ACTIVITYPUB_DOMAIN,
  });
});

app.delete("/microblog/:id", async (c) => {
  const id = c.req.param("id");
  const post = await Microblog.findByIdAndDelete(id);
  if (!post) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

export default app;
