import { Hono } from "hono";
import { createDB } from "../DB/mod.ts";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../shared/config.ts";

const app = new Hono();
app.use("/files/*", authRequired);

app.post("/files", async (c) => {
  const { content, mediaType, key, iv } = await c.req.json();
  if (typeof content !== "string") {
    return c.json({ error: "invalid body" }, 400);
  }
  const env = getEnv(c);
  const db = createDB(env);
  const domain = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const obj = await db.saveObject({
    type: "Attachment",
    attributedTo: `https://${domain}/system`,
    content,
    extra: { mediaType, key, iv },
  });
  return c.json({ url: `https://${domain}/api/files/${obj._id}` }, 201);
});

app.get("/files/:id", async (c) => {
  const id = c.req.param("id");
  const env = getEnv(c);
  const db = createDB(env);
  const doc = await db.getObject(id) as {
    content?: string;
    extra?: Record<string, unknown>;
  } | null;
  if (!doc || typeof doc.content !== "string") return c.text("Not Found", 404);
  const mediaType = typeof doc.extra?.mediaType === "string"
    ? doc.extra.mediaType
    : "application/octet-stream";
  const bin = atob(doc.content);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { "content-type": mediaType } });
});

export default app;
