import { Hono } from "hono";
import { Extension } from "./models/extension.ts";
import type { Env } from "./index.ts";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/extensions/:id/ui", async (c) => {
  const id = c.req.param("id");
  const ext = await Extension.findOne({ identifier: id });
  if (!ext || !ext.ui) return c.notFound();
  c.header("Content-Type", "text/html; charset=utf-8");
  return c.html(ext.ui);
});

export default app;
