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
    `window.__takosEventDefs["${id}"]=${eventDefs};</script>`;
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
  c.header("Cache-Control", "no-store");
  return c.body(ext.client);
});

app.get("/api/extensions/:id/manifest.json", async (c) => {
  const id = c.req.param("id");
  const ext = await Extension.findOne({ identifier: id });
  if (!ext || !ext.manifest) return c.notFound();
  c.header("Content-Type", "application/json; charset=utf-8");
  return c.json(ext.manifest);
});

app.get("/api/extensions/:id/sw.js", async (c) => {
  const id = c.req.param("id");
  const ext = await Extension.findOne({ identifier: id });
  if (!ext || !ext.client) return c.notFound();
  const tpl = await Deno.readTextFile(
    new URL("./sw_extension_template.js", import.meta.url),
  );
  const code = tpl.replace(
    "__CLIENT_PATH__",
    `/api/extensions/${id}/client.js`,
  );
  c.header("Content-Type", "application/javascript; charset=utf-8");
  c.header("Cache-Control", "no-store");
  return c.body(code);
});

export default app;
