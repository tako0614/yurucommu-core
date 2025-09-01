import { type Context, Hono } from "hono";
import authRequired from "../utils/auth.ts";
import { getDB } from "../db/mod.ts";
import { getEnv } from "@takos/config";
import { getFile, getMessageAttachment, saveFile } from "../services/file.ts";
import { getMaxFileSize, isAllowedFileType } from "../utils/file_config.ts";

// ストレージは DB API から注入されるため初期化は不要
export async function initFileModule(_env: Record<string, string>) {}

// すべて環境変数で制御するため、コード内のデフォルトは持たない

const app = new Hono();
const auth = (c: Context, next: () => Promise<void>) =>
  authRequired(getDB(c))(c, next);

app.post("/files", auth, async (c) => {
  const env = getEnv(c);
  const db = getDB(c);
  const MAX_FILE_SIZE = getMaxFileSize(env);

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "invalid body" }, 400);
  }

  if (typeof MAX_FILE_SIZE === "number" && file.size > MAX_FILE_SIZE) {
    return c.json({
      error: `File too large. Maximum size is ${
        Math.round(MAX_FILE_SIZE / 1024 / 1024)
      }MB`,
    }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mediaType = file.type || "application/octet-stream";
  const filename = file.name;
  const key = form.get("key")?.toString();
  const iv = form.get("iv")?.toString();
  const ext = (() => {
    const idx = file.name.lastIndexOf(".");
    return idx >= 0 ? file.name.slice(idx) : "";
  })();

  if (!isAllowedFileType(mediaType, filename, env)) {
    return c.json({ error: "File type not allowed" }, 400);
  }

  const { url } = await saveFile(db, bytes, env, { mediaType, key, iv, ext });
  return c.json({ url }, 201);
});

app.get("/files/:id", async (c) => {
  const id = c.req.param("id");
  const res = await getFile(getDB(c), id);
  if (!res) return c.text("Not Found", 404);
  return new Response(res.data, { headers: { "content-type": res.mediaType } });
});

app.get("/files/messages/:id/:index", async (c) => {
  const id = c.req.param("id");
  const index = parseInt(c.req.param("index"), 10) || 0;
  const res = await getMessageAttachment(getDB(c), id, index);
  if (!res) return c.text("Not Found", 404);
  return new Response(res.data, { headers: { "content-type": res.mediaType } });
});

export default app;
