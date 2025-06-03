/**
 * Takopack Builder 3.0
 *
 * toString依存をゼロにした静的import保持型ビルドシステム
 * - AST解析による関数自動抽出
 * - Virtual entrypoint生成
 * - esbuildによる依存解決とバンドル
 */

export { defineConfig } from "./src/config.ts";
export type { TakopackConfig } from "./src/types.ts";
export { TakopackBuilder } from "./src/builder.ts";
export { createCLI } from "./src/cli.ts";

// 便利なエクスポート関数
export { build, dev, watch } from "./src/commands.ts";

// TypeScript型エクスポート
export type * from "./src/types.ts";
