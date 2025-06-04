import { Hono } from "hono";
import { Env } from "./index.ts";
import { Extention } from "./models/extentions.ts";

const app = new Hono<{ Bindings: Env }>();

// 拡張機能のアセット配信エンドポイント
app.get("/:identifier/*", async (c) => {
  try {
    const identifier = c.req.param("identifier");
    const path = c.req.param("*"); // パスの残りの部分を取得

    // 拡張機能の存在確認
    const extension = await Extention.findOne({ id: identifier });
    if (!extension) {
      return c.json({ error: "Extension not found" }, 404);
    }

    // ファイルシステムからアセットを読み取り
    const fs = await import("fs/promises");
    const assetPath = `./assets/${identifier}/${path}`;

    try {
      const stat = await fs.stat(assetPath);

      // ディレクトリの場合はエラー
      if (stat.isDirectory()) {
        return c.json({ error: "Directory access not allowed" }, 403);
      }

      // ファイルを読み取り
      const content = await fs.readFile(assetPath);
      // Content-Typeを推定
      const contentType = getContentType(path || "");

      // キャッシュヘッダーを設定（デフォルトで1時間）
      c.header("Cache-Control", "public, max-age=3600");
      c.header("Content-Type", contentType);

      return new Response(content, {
        status: 200,
        headers: c.res.headers,
      });
    } catch (error) {
      if (
        error instanceof Error && "code" in error &&
        (error as { code: string }).code === "ENOENT"
      ) {
        return c.json({ error: "Asset not found" }, 404);
      }
      throw error;
    }
  } catch (error) {
    console.error("CDN asset error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// アセット一覧取得（デバッグ用）
app.get("/:identifier", async (c) => {
  try {
    const identifier = c.req.param("identifier");

    // 拡張機能の存在確認
    const extension = await Extention.findOne({ id: identifier });
    if (!extension) {
      return c.json({ error: "Extension not found" }, 404);
    }

    // アセットディレクトリの内容を取得
    const fs = await import("fs/promises");
    const assetDir = `./assets/${identifier}`;

    try {
      const files = await fs.readdir(assetDir, { recursive: true });
      const fileList = files.map((f) => f.toString()).filter((f) => {
        // ディレクトリを除外
        return !f.endsWith("/");
      });

      return c.json({
        identifier,
        assets: fileList,
        total: fileList.length,
      });
    } catch (error) {
      if ((error as { code?: string })?.code === "ENOENT") {
        return c.json({
          identifier,
          assets: [],
          total: 0,
        });
      }
      throw error;
    }
  } catch (error) {
    console.error("CDN asset list error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Content-Typeを推定する関数
function getContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "html":
      return "text/html";
    case "css":
      return "text/css";
    case "js":
    case "mjs":
      return "application/javascript";
    case "json":
      return "application/json";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    case "ico":
      return "image/x-icon";
    case "woff":
      return "font/woff";
    case "woff2":
      return "font/woff2";
    case "ttf":
      return "font/ttf";
    case "eot":
      return "application/vnd.ms-fontobject";
    case "pdf":
      return "application/pdf";
    case "zip":
      return "application/zip";
    case "txt":
      return "text/plain";
    case "md":
      return "text/markdown";
    case "xml":
      return "application/xml";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    default:
      return "application/octet-stream";
  }
}

export default app;
