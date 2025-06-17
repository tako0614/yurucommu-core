import { Hono } from "hono";
import { Extension } from "./models/extension.ts";
import type { Env } from "./index.ts";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/extensions/:id/ui", async (c) => {
  const id = c.req.param("id");
  const ext = await Extension.findOne({ identifier: id });
  if (!ext || !ext.ui) return c.notFound();
  c.header("Content-Type", "text/html; charset=utf-8");
  const eventDefs = JSON.stringify(ext.manifest?.eventDefinitions || {});
  const script =
    `<script>try{if(!window.takos&&window.parent)window.takos=window.parent.takos;}catch(e){};` +
    `window.__takosEventDefs=window.__takosEventDefs||{};` +
    `window.__takosEventDefs["${id}"]=${eventDefs};</script>` +
    `<script type="module" src="/api/extensions/${id}/client.js"></script>`;
  const html = ext.ui.includes("</head>")
    ? ext.ui.replace("</head>", script + "</head>")
    : script + ext.ui;
  return c.html(html);
});

app.get("/api/extensions/:id/client.js", async (c) => {
  const id = c.req.param("id");
  const ext = await Extension.findOne({ identifier: id });
  if (!ext || !ext.client) return c.notFound();
  c.header("Content-Type", "application/javascript; charset=utf-8");
  return c.body(ext.client);
});

export default app;
