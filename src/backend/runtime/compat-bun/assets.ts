/**
 * Bun Cloudflare Compatibility Layer - Assets Fetcher
 */

import { realpath, stat } from "./utils.ts";
import type { BunRuntime } from "./types.ts";
import { isPathWithinBasePath, resolvePathWithinBasePath } from "../shared.ts";
import path from "node:path";

declare const Bun: BunRuntime;

/**
 * Fetcher-compatible static assets implementation for Bun
 */
export class AssetsCompatFetcher {
  private basePath: string;
  private realBasePath: string | null = null;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static create(basePath: string): AssetsCompatFetcher {
    return new AssetsCompatFetcher(basePath);
  }

  private getResolvedBasePath(): string {
    return path.resolve(this.basePath);
  }

  private async getRealBasePath(): Promise<string> {
    if (this.realBasePath) return this.realBasePath;
    try {
      this.realBasePath = await realpath(this.getResolvedBasePath());
    } catch {
      this.realBasePath = this.getResolvedBasePath();
    }
    return this.realBasePath;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let filePath: string;
    try {
      filePath = resolvePathWithinBasePath(
        this.getResolvedBasePath(),
        `.${url.pathname}`,
      );
    } catch {
      return new Response("Forbidden", { status: 403 });
    }

    const realBasePath = await this.getRealBasePath();

    try {
      const realFilePath = await realpath(filePath);
      if (!isPathWithinBasePath(realBasePath, realFilePath)) {
        return new Response("Forbidden", { status: 403 });
      }

      const fileStats = await stat(realFilePath);
      let file = Bun.file(realFilePath);

      if (fileStats.isDirectory()) {
        const indexPath = path.join(realFilePath, "index.html");
        const realIndexPath = await realpath(indexPath);
        if (!isPathWithinBasePath(realBasePath, realIndexPath)) {
          return new Response("Forbidden", { status: 403 });
        }
        filePath = realIndexPath;
        file = Bun.file(filePath);
      } else {
        filePath = realFilePath;
      }

      if (await file.exists()) {
        return new Response(file);
      }

      // SPA fallback
      const indexPath = path.join(this.getResolvedBasePath(), "index.html");
      const realIndexPath = await realpath(indexPath);
      if (!isPathWithinBasePath(realBasePath, realIndexPath)) {
        return new Response("Forbidden", { status: 403 });
      }
      const indexFile = Bun.file(realIndexPath);
      if (await indexFile.exists()) {
        return new Response(indexFile, {
          headers: { "Content-Type": "text/html" },
        });
      }

      return new Response("Not Found", { status: 404 });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  }
}
