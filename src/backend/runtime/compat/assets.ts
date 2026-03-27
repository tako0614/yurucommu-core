/**
 * Fetcher-compatible static assets implementation
 *
 * Provides AssetsCompatFetcher that serves static files from the
 * filesystem, mimicking Cloudflare Workers Assets binding.
 */

import { loadNodeModules, getFs, getPath } from './node-modules';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function getMimeType(ext: string): string {
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Fetcher-compatible static assets implementation
 */
export class AssetsCompatFetcher {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static async create(basePath: string): Promise<AssetsCompatFetcher> {
    await loadNodeModules();
    return new AssetsCompatFetcher(basePath);
  }

  async fetch(request: Request): Promise<Response> {
    const fs = getFs();
    const path = getPath();
    const url = new URL(request.url);
    let filePath = path.join(this.basePath, url.pathname);

    // Security: prevent directory traversal
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(this.basePath))) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }

      const content = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = getMimeType(ext);

      return new Response(content, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(content.length),
        },
      });
    } catch {
      // SPA fallback
      try {
        const indexPath = path.join(this.basePath, 'index.html');
        const content = await fs.readFile(indexPath);
        return new Response(content, {
          headers: { 'Content-Type': 'text/html' },
        });
      } catch {
        return new Response('Not Found', { status: 404 });
      }
    }
  }
}
