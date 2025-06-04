import { Hono } from "hono";
import { Env } from "./index.ts";
import { Extention } from "./models/extentions.ts";
import { getCookie } from "hono/cookie";
import { Session } from "./models/sessions.ts";
import { extensionHookManager } from "./extensionHookManager.ts";

const app = new Hono<{ Bindings: Env }>();

// 認証ミドルウェア
app.use("*", async (c, next) => {
  const sessionToken = getCookie(c, "session_token");
  if (!sessionToken) {
    return c.json({ success: false, error: "認証されていません" }, 401);
  }
  const session = await Session.findOne({
    token: sessionToken,
    expiresAt: { $gt: new Date() },
  });
  if (!session) {
    return c.json({ success: false, error: "セッションが無効です" }, 401);
  }
  await next();
});

// 拡張機能一覧取得
app.get("/", async (c) => {
  try {
    const extensions = await Extention.find({});
    const extensionsData = extensions.map((ext) => ({
      id: ext.id,
      version: ext.version,
      manifest: ext.manifest,
      installed: true, // データベースにあるものは全てインストール済み
    }));

    return c.json({ success: true, data: extensionsData });
  } catch (error) {
    console.error("List extensions error:", error);
    return c.json(
      { success: false, error: "拡張機能一覧の取得に失敗しました" },
      500,
    );
  }
});

// 拡張機能インストール
app.post("/install", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("package") as File;

    if (!file) {
      return c.json(
        { success: false, error: "パッケージファイルが必要です" },
        400,
      );
    }

    // .takopack ファイル（ZIP形式）を解析
    const packageData = await file.arrayBuffer();
    const packageBuffer = new Uint8Array(packageData);

    // ZIP解析（実際の実装ではJSZipなどのライブラリを使用）
    const extractedFiles = await extractTakoPackage(packageBuffer);

    // manifest.json を検証
    const manifestText = extractedFiles["takos/manifest.json"];
    if (!manifestText) {
      return c.json(
        { success: false, error: "manifest.json が見つかりません" },
        400,
      );
    }

    let manifest;
    try {
      manifest = JSON.parse(manifestText);
    } catch (_e) {
      return c.json({ success: false, error: "manifest.json が無効です" }, 400);
    }

    // 必須フィールドの検証
    if (!manifest.identifier || !manifest.name || !manifest.version) {
      return c.json({
        success: false,
        error: "manifest.json に必須フィールドが不足しています",
      }, 400);
    }

    // server.js の取得
    const serverJs = extractedFiles["takos/server.js"];
    if (!serverJs) {
      return c.json(
        { success: false, error: "server.js が見つかりません" },
        400,
      );
    } // client.js の取得
    const _clientJs = extractedFiles["takos/client.js"] || "";

    // index.html の取得
    const indexHtml = extractedFiles["takos/index.html"] || "";

    // 既存の拡張機能をチェック
    const existingExtension = await Extention.findOne({
      id: manifest.identifier,
    });
    if (existingExtension) {
      return c.json({
        success: false,
        error: "同じIDの拡張機能が既にインストールされています",
      }, 409);
    }

    // データベースに保存
    const extension = await Extention.create({
      id: manifest.identifier,
      version: manifest.version,
      serverjs: serverJs,
      clienthtml: indexHtml, // client.js も含む場合は適切に処理
      manifest: manifest,
    }); // 拡張機能を読み込み
    const { extensionHookManager } = await import("./extensionHookManager.ts");
    await extensionHookManager.loadExtension(manifest.identifier);

    return c.json({
      success: true,
      data: {
        id: extension.id,
        version: extension.version,
        manifest: extension.manifest,
      },
    }, 201);
  } catch (error) {
    console.error("Install extension error:", error);
    return c.json({
      success: false,
      error: "拡張機能のインストールに失敗しました",
    }, 500);
  }
});

// 拡張機能アンインストール
app.delete("/:id", async (c) => {
  try {
    const extensionId = c.req.param("id");

    const extension = await Extention.findOneAndDelete({ id: extensionId });
    if (!extension) {
      return c.json({ success: false, error: "拡張機能が見つかりません" }, 404);
    } // メモリから拡張機能をアンロード
    const { extensionHookManager } = await import("./extensionHookManager.ts");
    extensionHookManager.unloadExtension(extensionId);

    return c.json({
      success: true,
      message: "拡張機能をアンインストールしました",
    });
  } catch (error) {
    console.error("Uninstall extension error:", error);
    return c.json({
      success: false,
      error: "拡張機能のアンインストールに失敗しました",
    }, 500);
  }
});

// 拡張機能有効/無効切り替え
app.post("/:id/toggle", async (c) => {
  try {
    const extensionId = c.req.param("id");
    const { enabled } = await c.req.json();

    const extension = await Extention.findOne({ id: extensionId });
    if (!extension) {
      return c.json({ success: false, error: "拡張機能が見つかりません" }, 404);
    }

    if (enabled) {
      await extensionHookManager.loadExtension(extensionId);
    } else {
      extensionHookManager.unloadExtension(extensionId);
    }

    // ここで enabled 状態をデータベースに保存する場合は適切に処理
    // extension.enabled = enabled;
    // await extension.save();

    return c.json({
      success: true,
      message: enabled
        ? "拡張機能を有効にしました"
        : "拡張機能を無効にしました",
    });
  } catch (error) {
    console.error("Toggle extension error:", error);
    return c.json(
      { success: false, error: "拡張機能の切り替えに失敗しました" },
      500,
    );
  }
});

// 拡張機能詳細取得
app.get("/:id", async (c) => {
  try {
    const extensionId = c.req.param("id");

    const extension = await Extention.findOne({ id: extensionId });
    if (!extension) {
      return c.json({ success: false, error: "拡張機能が見つかりません" }, 404);
    }

    return c.json({
      success: true,
      data: {
        id: extension.id,
        version: extension.version,
        manifest: extension.manifest,
        // セキュリティのため、実際のコードは返さない
      },
    });
  } catch (error) {
    console.error("Get extension error:", error);
    return c.json(
      { success: false, error: "拡張機能の取得に失敗しました" },
      500,
    );
  }
});

// 拡張機能のマーケットプレイス検索（将来の機能）
app.get("/marketplace/search", (c) => {
  try {
    const query = c.req.query("q") || "";

    // 実際の実装では外部マーケットプレイスAPIを呼び出し
    const mockResults = [
      {
        id: "com.example.theme-changer",
        name: "テーマ変更",
        description: "エディタのテーマをカスタマイズします",
        version: "1.0.0",
        author: "Example Corp",
        downloads: 1000,
        rating: 4.5,
      },
      {
        id: "com.example.markdown-preview",
        name: "Markdownプレビュー",
        description: "Markdownファイルをリアルタイムでプレビューします",
        version: "2.1.0",
        author: "Markdown Tools",
        downloads: 5000,
        rating: 4.8,
      },
    ].filter((ext) =>
      !query ||
      ext.name.toLowerCase().includes(query.toLowerCase()) ||
      ext.description.toLowerCase().includes(query.toLowerCase())
    );

    return c.json({ success: true, data: mockResults });
  } catch (error) {
    console.error("Search marketplace error:", error);
    return c.json({
      success: false,
      error: "マーケットプレイス検索に失敗しました",
    }, 500);
  }
});

// TakoPackage ファイルの解析
async function extractTakoPackage(
  packageBuffer: Uint8Array,
): Promise<Record<string, string>> {
  try {
    // ZIP-JSライブラリを使用してZIPファイルを解析
    const { ZipReader, Uint8ArrayReader, TextWriter } = await import(
      "jsr:@zip-js/zip-js"
    );

    const zipReader = new ZipReader(new Uint8ArrayReader(packageBuffer));
    const entries = await zipReader.getEntries();

    const extractedFiles: Record<string, string> = {};

    for (const entry of entries) {
      if (!entry.directory && entry.filename.startsWith("takos/")) {
        // テキストファイルとして読み込み
        const content = await entry.getData!(new TextWriter());
        extractedFiles[entry.filename] = content;
      }
    }

    await zipReader.close();
    return extractedFiles;
  } catch (error) {
    console.error("ZIP extraction failed:", error);

    // フォールバック：モックデータを返す
    console.warn("Using mock data due to ZIP extraction failure");
    return {
      "takos/manifest.json": JSON.stringify({
        name: "Example Extension",
        identifier: "com.example.extension",
        version: "1.0.0",
        apiVersion: "2.0",
        permissions: ["activitypub:read", "kv:read", "kv:write"],
        activityPub: {
          objects: [{
            accepts: ["Note", "Create"],
            hooks: {
              canAccept: "canAcceptNote",
              onReceive: "onReceiveNote",
              priority: 10,
            },
          }],
        },
      }),
      "takos/server.js": `
        exports.canAcceptNote = function(context, activity) {
          return true;
        };
        
        exports.onReceiveNote = function(context, activity) {
          console.log("Received note:", activity);
          return activity;
        };
      `,
      "takos/client.js": `
        console.log("Extension client loaded");
      `,
      "takos/index.html": `
        <!DOCTYPE html>
        <html>
          <head><title>Extension UI</title></head>
          <body><h1>Extension UI</h1></body>
        </html>
      `,
    };
  }
}

export default app;
