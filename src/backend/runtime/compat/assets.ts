/**
 * Fetcher-compatible static assets implementation
 *
 * Provides AssetsCompatFetcher that serves static files from the
 * filesystem, mimicking Cloudflare Workers Assets binding.
 */

import { getFs, getPath, loadNodeModules } from "./node-modules.ts";
import { isPathWithinBasePath, resolvePathWithinBasePath } from "../shared.ts";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function getMimeType(ext: string): string {
  return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * Fetcher-compatible static assets implementation
 */
export class AssetsCompatFetcher {
  private basePath: string;
  private realBasePath: string | null = null;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static async create(basePath: string): Promise<AssetsCompatFetcher> {
    await loadNodeModules();
    return new AssetsCompatFetcher(basePath);
  }

  private getResolvedBasePath(): string {
    return getPath().resolve(this.basePath);
  }

  private async getRealBasePath(): Promise<string> {
    if (this.realBasePath) return this.realBasePath;
    try {
      this.realBasePath = await getFs().realpath(this.getResolvedBasePath());
    } catch {
      this.realBasePath = this.getResolvedBasePath();
    }
    return this.realBasePath;
  }

  async fetch(request: Request): Promise<Response> {
    const fs = getFs();
    const path = getPath();
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
      const realFilePath = await fs.realpath(filePath);
      if (!isPathWithinBasePath(realBasePath, realFilePath)) {
        return new Response("Forbidden", { status: 403 });
      }

      const stats = await fs.stat(realFilePath);
      if (stats.isDirectory()) {
        const indexPath = path.join(realFilePath, "index.html");
        const realIndexPath = await fs.realpath(indexPath);
        if (!isPathWithinBasePath(realBasePath, realIndexPath)) {
          return new Response("Forbidden", { status: 403 });
        }
        filePath = realIndexPath;
      } else {
        filePath = realFilePath;
      }

      const content = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = getMimeType(ext);

      return new Response(new Uint8Array(content), {
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(content.length),
        },
      });
    } catch {
      // SPA fallback
      try {
        const indexPath = path.join(this.getResolvedBasePath(), "index.html");
        const realIndexPath = await fs.realpath(indexPath);
        if (!isPathWithinBasePath(realBasePath, realIndexPath)) {
          return new Response("Forbidden", { status: 403 });
        }
        const content = await fs.readFile(realIndexPath);
        return new Response(new Uint8Array(content), {
          headers: { "Content-Type": "text/html" },
        });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    }
  }
}
