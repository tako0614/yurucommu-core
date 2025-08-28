import { Hono } from "hono";
import { extname } from "@std/path";
import authRequired from "../utils/auth.ts";
import { getEnv } from "@takos/config";
import { getFile, getMessageAttachment, saveFile } from "../services/file.ts";

// ストレージは DB API から注入されるため初期化は不要
export async function initFileModule(_env: Record<string, string>) {}

// すべて環境変数で制御するため、コード内のデフォルトは持たない

function parseSizeToBytes(v?: string): number | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  // 数値のみ: バイトとして解釈
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/^(\d+)(b|kb|mb|gb)?$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] || "b").toLowerCase();
  switch (unit) {
    case "b":
      return n;
    case "kb":
      return n * 1024;
    case "mb":
      return n * 1024 * 1024;
    case "gb":
      return n * 1024 * 1024 * 1024;
    default:
      return undefined;
  }
}

function getListFromEnv(
  env: Record<string, string>,
  key: string,
): string[] | undefined {
  const raw = env[key];
  if (!raw) return undefined;
  return raw.split(",").map((x) => x.trim()).filter(Boolean);
}

function getMaxFileSize(env: Record<string, string>): number | undefined {
  return parseSizeToBytes(env["FILE_MAX_SIZE"]);
}

function getAllowedMimeTypes(
  env: Record<string, string>,
): string[] | undefined {
  const list = getListFromEnv(env, "FILE_ALLOWED_MIME_TYPES");
  return (list && list.length > 0) ? list : undefined;
}

function getBlockedMimeTypes(
  env: Record<string, string>,
): string[] | undefined {
  const list = getListFromEnv(env, "FILE_BLOCKED_MIME_TYPES");
  return (list && list.length > 0) ? list : undefined;
}

function getBlockedExtensions(
  env: Record<string, string>,
): string[] | undefined {
  const list = getListFromEnv(env, "FILE_BLOCKED_EXTENSIONS");
  return (list && list.length > 0)
    ? list.map((x) => x.toLowerCase())
    : undefined;
}

function isAllowedFileType(
  mediaType: string,
  filename: string | undefined,
  env: Record<string, string>,
): boolean {
  const allowed = getAllowedMimeTypes(env);
  const blockedMime = getBlockedMimeTypes(env);
  const blockedExts = getBlockedExtensions(env);

  // 許可リストが設定されている場合のみ厳格チェック
  if (allowed && allowed.length > 0) {
    if (!allowed.includes(mediaType)) return false;
  }

  // MIME ブラックリスト
  if (blockedMime && blockedMime.length > 0) {
    if (blockedMime.includes(mediaType)) return false;
  }

  // 拡張子ブラックリスト
  if (filename && blockedExts && blockedExts.length > 0) {
    const ext = extname(filename).toLowerCase();
    if (blockedExts.includes(ext)) return false;
  }
  return true;
}

const app = new Hono();

app.post("/files", authRequired, async (c) => {
  const env = getEnv(c);
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
  const ext = extname(file.name);

  if (!isAllowedFileType(mediaType, filename, env)) {
    return c.json({ error: "File type not allowed" }, 400);
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
