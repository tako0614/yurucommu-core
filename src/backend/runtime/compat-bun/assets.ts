// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck - This file is Bun-specific and should be type-checked by Bun's TypeScript
/**
 * Bun Cloudflare Compatibility Layer - Assets Fetcher
 */

/**
 * Fetcher-compatible static assets implementation for Bun
 */
export class AssetsCompatFetcher {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static create(basePath: string): AssetsCompatFetcher {
    return new AssetsCompatFetcher(basePath);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let filePath = `${this.basePath}${url.pathname}`;

    // Security: prevent directory traversal
    const normalizedPath = filePath.replace(/\.\./g, "");
    if (normalizedPath !== filePath) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      let file = Bun.file(filePath);

      if (!(await file.exists())) {
        filePath = `${filePath}/index.html`;
        file = Bun.file(filePath);
      }

      if (await file.exists()) {
        return new Response(file);
      }

      // SPA fallback
      const indexFile = Bun.file(`${this.basePath}/index.html`);
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
