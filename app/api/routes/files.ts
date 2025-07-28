import { Hono } from "hono";
import { extname } from "@std/path";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../shared/config.ts";
import {
  getFile,
  getMessageAttachment,
  initFileService,
  saveFile,
} from "../services/file.ts";

export async function initFileModule(env: Record<string, string>) {
  await initFileService(env);
}

const app = new Hono();
app.use("/files/*", authRequired);

app.post("/files", async (c) => {
  const env = getEnv(c);
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

  const { url } = await saveFile(bytes, env, { mediaType, key, iv, ext });
  return c.json({ url }, 201);
});

app.get("/files/:id", async (c) => {
  const id = c.req.param("id");
  const env = getEnv(c);
  const res = await getFile(id, env);
  if (!res) return c.text("Not Found", 404);
  return new Response(res.data, { headers: { "content-type": res.mediaType } });
});

app.get("/files/messages/:id/:index", async (c) => {
  const id = c.req.param("id");
  const index = parseInt(c.req.param("index"), 10) || 0;
  const env = getEnv(c);
  const res = await getMessageAttachment(id, index, env);
  if (!res) return c.text("Not Found", 404);
  return new Response(res.data, { headers: { "content-type": res.mediaType } });
});

export default app;
