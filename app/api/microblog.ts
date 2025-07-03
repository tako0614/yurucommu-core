import { Hono } from "hono";
import Microblog from "./models/microblog.ts";

const app = new Hono();

app.get("/microblog", async (c) => {
  const list = await Microblog.find().sort({ createdAt: -1 }).lean();
  const formatted = list.map((doc: Record<string, unknown>) => ({
    id: doc._id.toString(),
    author: doc.author,
    content: doc.content,
    createdAt: doc.createdAt,
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
  return c.json({
    id: post._id.toString(),
    author: post.author,
    content: post.content,
    createdAt: post.createdAt,
  }, 201);
});

app.get("/microblog/:id", async (c) => {
  const id = c.req.param("id");
  const post = await Microblog.findById(id).lean();
  if (!post) return c.json({ error: "Not found" }, 404);
  return c.json({
    id: post._id.toString(),
    author: post.author,
    content: post.content,
    createdAt: post.createdAt,
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
  return c.json({
    id: post._id.toString(),
    author: post.author,
    content: post.content,
    createdAt: post.createdAt,
  });
});

app.delete("/microblog/:id", async (c) => {
  const id = c.req.param("id");
  const post = await Microblog.findByIdAndDelete(id);
  if (!post) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

export default app;
