import { Hono } from "hono";
import { extname } from "@std/path";
import { createDB } from "../DB/mod.ts";
import authRequired from "../utils/auth.ts";
import {
  createStorage,
  type ObjectStorage,
} from "../services/object-storage.ts";
import { getEnv } from "../../shared/config.ts";

let storage: ObjectStorage;
export async function initFileModule(env: Record<string, string>) {
  const db = createDB(env);
  storage = await createStorage(env, db);
}

const app = new Hono();
app.use("/files/*", authRequired);

app.post("/files", async (c) => {
  const env = getEnv(c);
  const domain = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const contentType = c.req.header("content-type") || "";
  let bytes: Uint8Array | null = null;
  let mediaType = "application/octet-stream";
  let key: string | undefined;
  let iv: string | undefined;

  let ext = "";
  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "invalid body" }, 400);
    }
    bytes = new Uint8Array(await file.arrayBuffer());
    mediaType = file.type || mediaType;
    key = form.get("key")?.toString();
    iv = form.get("iv")?.toString();
    ext = extname(file.name);
  } else if (contentType === "application/octet-stream") {
    bytes = new Uint8Array(await c.req.arrayBuffer());
    mediaType = c.req.header("x-media-type") || mediaType;
    key = c.req.header("x-enc-key") || undefined;
    iv = c.req.header("x-enc-iv") || undefined;
  } else {
    const { content, mediaType: mt, key: k, iv: i } = await c.req.json();
    if (typeof content !== "string") {
      return c.json({ error: "invalid body" }, 400);
    }
    const bin = atob(content);
    const buf = new Uint8Array(bin.length);
    for (let i2 = 0; i2 < bin.length; i2++) buf[i2] = bin.charCodeAt(i2);
    bytes = buf;
    mediaType = typeof mt === "string" ? mt : mediaType;
    key = typeof k === "string" ? k : undefined;
    iv = typeof i === "string" ? i : undefined;
  }

  if (!bytes) {
    return c.json({ error: "invalid body" }, 400);
  }

  const filename = `${crypto.randomUUID()}${ext}`;
  const storageKey = `files/${filename}`;
  await storage.put(storageKey, bytes);

  const db = createDB(env);
  const obj = await db.saveObject({
    type: "Attachment",
    attributedTo: `https://${domain}/system`,
    extra: { mediaType, key, iv, storageKey },
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
  if (!doc) return c.text("Not Found", 404);
  const mediaType = typeof doc.extra?.mediaType === "string"
    ? doc.extra.mediaType
    : "application/octet-stream";
  const storageKey = typeof doc.extra?.storageKey === "string"
    ? doc.extra.storageKey
    : undefined;
  let data: Uint8Array | null = null;
  if (storageKey) {
    data = await storage.get(storageKey);
  } else if (typeof doc.content === "string") {
    const bin = atob(doc.content);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    data = bytes;
  }
  if (!data) return c.text("Not Found", 404);
  return new Response(data, { headers: { "content-type": mediaType } });
});

export { initFileModule };
export default app;
