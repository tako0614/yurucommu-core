import { Hono } from "hono";
import { Extension } from "./models/extension.ts";
import type { Env } from "./index.ts";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/extensions/:id/ui", async (c) => {
  const id = c.req.param("id");
  const ext = await Extension.findOne({ identifier: id });
  if (!ext || !ext.ui) return c.notFound();
  c.header("Content-Type", "text/html; charset=utf-8");
  const script =
    '<script>window.takos = window.parent && window.parent.takos;</script>';
  const html = ext.ui.includes("</head>")
    ? ext.ui.replace("</head>", script + "</head>")
    : script + ext.ui;
  return c.html(html);
});

export default app;
