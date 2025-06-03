import type { TakopackConfig } from "./types.ts";

/**
 * 設定定義ヘルパー関数
 */
export function defineConfig(config: TakopackConfig): TakopackConfig {
  return config;
}

/**
 * デフォルト設定
 */
export const defaultConfig: Partial<TakopackConfig> = {
  build: {
    target: "es2022",
    dev: false,
    analysis: false,
    outDir: "dist",
    minify: true,
  },
  entries: {
    server: [],
    client: [],
    ui: [],
  },
  plugins: [],
};
