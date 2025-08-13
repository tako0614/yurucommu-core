import { Hono } from "hono";
import { extname } from "@std/path";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../shared/config.ts";
import { b64ToBuf } from "../../shared/buffer.ts";
import {
  getFile,
  getMessageAttachment,
  initFileService,
  saveFile,
} from "../services/file.ts";

export async function initFileModule(env: Record<string, string>) {
  await initFileService(env);
}

// ファイルアップロードの設定
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = [
  // 画像
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // 動画
  'video/mp4',
  'video/webm',
  'video/ogg',
  // 音声
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  // ドキュメント
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
];

// 危険な拡張子のブラックリスト
const BLOCKED_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr',
  '.vbs', '.js', '.jar', '.app', '.deb', '.rpm',
  '.sh', '.bash', '.ps1', '.psm1', '.psd1',
];

function isAllowedFileType(mediaType: string, filename?: string): boolean {
  // MIMEタイプのチェック
  if (!ALLOWED_MIME_TYPES.includes(mediaType)) {
    return false;
  }
  
  // ファイル拡張子のチェック
  if (filename) {
    const ext = extname(filename).toLowerCase();
    if (BLOCKED_EXTENSIONS.includes(ext)) {
      return false;
    }
  }
  
  return true;
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
  let filename: string | undefined;

  let ext = "";
  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "invalid body" }, 400);
    }
    
    // ファイルサイズのチェック
    if (file.size > MAX_FILE_SIZE) {
      return c.json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` }, 400);
    }
    
    bytes = new Uint8Array(await file.arrayBuffer());
    mediaType = file.type || mediaType;
    filename = file.name;
    key = form.get("key")?.toString();
    iv = form.get("iv")?.toString();
    ext = extname(file.name);
  } else if (contentType === "application/octet-stream") {
    const arrayBuffer = await c.req.arrayBuffer();
    
    // ファイルサイズのチェック
    if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
      return c.json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` }, 400);
    }
    
    bytes = new Uint8Array(arrayBuffer);
    mediaType = c.req.header("x-media-type") || mediaType;
    filename = c.req.header("x-filename");
    key = c.req.header("x-enc-key") || undefined;
    iv = c.req.header("x-enc-iv") || undefined;
  } else {
    const { content, mediaType: mt, key: k, iv: i } = await c.req.json();
    if (typeof content !== "string") {
      return c.json({ error: "invalid body" }, 400);
    }
    bytes = b64ToBuf(content);
    
    // ファイルサイズのチェック
    if (bytes.byteLength > MAX_FILE_SIZE) {
      return c.json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` }, 400);
    }
    
    mediaType = typeof mt === "string" ? mt : mediaType;
    key = typeof k === "string" ? k : undefined;
    iv = typeof i === "string" ? i : undefined;
  }

  if (!bytes) {
    return c.json({ error: "invalid body" }, 400);
  }
  
  // ファイルタイプの検証
  if (!isAllowedFileType(mediaType, filename)) {
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
