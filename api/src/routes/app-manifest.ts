/**
 * App Manifest API
 *
 * PLAN.md 5.4 に基づく App Manifest の配信エンドポイント
 */

import { Hono } from "hono";
import type { PublicAccountBindings as Bindings } from "@takos/platform/server";
import { fail } from "@takos/platform/server";
import { loadAppManifest, createInMemoryAppSource } from "@takos/platform/app/manifest-loader";
import type { AppDefinitionSource } from "@takos/platform/app";
import { optionalAuth } from "../middleware/auth";

// Static manifest files bundled at build time
import takosAppJson from "../../../takos-app.json";
import screensCoreJson from "../../../app/views/screens-core.json";
import insertCoreJson from "../../../app/views/insert-core.json";

const app = new Hono<{ Bindings: Bindings }>();

/**
 * App Manifest の取得
 *
 * GET /-/app/manifest
 *
 * takos-app.json と app/ 以下の *.json をマージして返す
 */
app.get("/", optionalAuth, async (c) => {
  try {
    // 現在は、ビルド時に生成された静的マニフェストを返す実装
    // 将来的には KV や D1 から動的にロードする実装に変更可能
    const source = await createManifestSource(c.env);

    const result = await loadAppManifest({
      rootDir: ".",
      source,
    });

    // エラーがある場合
    const errors = result.issues?.filter((issue) => issue.severity === "error");
    if (errors && errors.length > 0) {
      return c.json(
        {
          error: "App manifest validation failed",
          issues: result.issues,
        },
        400,
      );
    }

    // 警告のみの場合は manifest を返す
    return c.json({
      manifest: result.manifest,
      issues: result.issues || [],
    });
  } catch (err) {
    console.error("Failed to load app manifest:", err);
    return fail(c, "Failed to load app manifest", 500);
  }
});

/**
 * Manifest ソース作成
 *
 * Node.js 環境では fs を使用し、Workers 環境ではビルド時の静的ファイルを使用
 */
async function createManifestSource(env: any): Promise<AppDefinitionSource> {
  // Node.js 環境の検出
  if (typeof process !== "undefined" && process.versions && process.versions.node) {
    return createNodeFsSource();
  }

  // Cloudflare Workers 環境では、ビルド時にバンドルされた manifest を返す
  return createStaticSource();
}

/**
 * Node.js fs ベースのソース
 */
function createNodeFsSource(): AppDefinitionSource {
  // Dynamic import for Node.js environment
  const fs = require("fs");
  const path = require("path");

  return {
    async readFile(filePath: string): Promise<string> {
      return fs.promises.readFile(filePath, "utf-8");
    },

    async listFiles(dirPath: string): Promise<string[]> {
      try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        return entries
          .filter((entry: any) => entry.isFile() && entry.name.endsWith(".json"))
          .map((entry: any) => entry.name);
      } catch (err: any) {
        if (err.code === "ENOENT") {
          return [];
        }
        throw err;
      }
    },
  };
}

/**
 * 静的マニフェスト（ビルド時バンドル）を返すソース
 *
 * Cloudflare Workers では、ビルドプロセスで JSON ファイルをバンドル
 */
function createStaticSource(): AppDefinitionSource {
  // ビルド時にインポートされた JSON ファイルをインメモリソースとして提供
  const files: Record<string, string> = {
    "takos-app.json": JSON.stringify(takosAppJson),
    "app/views/screens-core.json": JSON.stringify(screensCoreJson),
    "app/views/insert-core.json": JSON.stringify(insertCoreJson),
  };

  return createInMemoryAppSource(files);
}

export default app;
