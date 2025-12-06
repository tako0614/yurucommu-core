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
    // Cloudflare Workers / workerd では、ビルド時にバンドルされた静的マニフェストを使用
    const source = createStaticSource();

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
 * 静的マニフェスト（ビルド時バンドル）を返すソース
 *
 * Cloudflare Workers / workerd では、ビルドプロセスで JSON ファイルをバンドル
 * (Node.js fs 機能は platform/adapters/node.ts に分離)
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
