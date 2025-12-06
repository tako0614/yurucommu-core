/**
 * Node.js specific utilities for takos-config
 *
 * This file contains Node.js specific implementations that should NOT be
 * imported in Cloudflare Workers / workerd environments.
 */

import { parseTakosConfig, type TakosConfig } from "./takos-config";

/**
 * Load takos-config.json from file system (Node.js only)
 * This function should only be called in Node.js environments
 */
export async function loadTakosConfig(filePath = "takos-config.json"): Promise<TakosConfig> {
  const fs = await import("node:fs/promises");
  const content = await fs.readFile(filePath, "utf-8");
  return parseTakosConfig(content);
}
