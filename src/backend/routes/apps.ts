import { Hono } from "hono";
import type { Env, Variables } from "../types.ts";
import { requireBearerAuth } from "../middleware/bearer-auth.ts";
import { rateLimit, RateLimitConfigs } from "../middleware/rate-limit.ts";

type AppEnv = { Bindings: Env; Variables: Variables };

const MAX_FILES = 1000;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".map": "application/json; charset=utf-8",
};

function inferContentType(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

// Deploy API (mounted at /api/apps)

export const appsApiRoutes = new Hono<AppEnv>();

appsApiRoutes.use("/:name/deploy", rateLimit(RateLimitConfigs.mediaUpload));

appsApiRoutes.post(
  "/:name/deploy",
  requireBearerAuth("apps:deploy"),
  async (c) => {
    const appName = c.req.param("name");
    const token = c.get("oauthToken")!;

    // Validate app name: alphanumeric, hyphens, underscores only
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(appName)) {
      return c.json({
        error: "invalid_request",
        error_description: "Invalid app name",
      }, 400);
    }

    let body: { files?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        error: "invalid_request",
        error_description: "Invalid JSON body",
      }, 400);
    }

    if (!Array.isArray(body.files)) {
      return c.json({
        error: "invalid_request",
        error_description: "files must be an array",
      }, 400);
    }

    if (body.files.length > MAX_FILES) {
      return c.json({
        error: "invalid_request",
        error_description: `Too many files (max ${MAX_FILES})`,
      }, 400);
    }

    const files = body.files as Array<
      { path?: unknown; content?: unknown; contentType?: unknown }
    >;
    const appPrefix = `hosted/${token.sub}/${appName}/`;

    const results: Array<{ path: string; status: string }> = [];

    for (const file of files) {
      if (typeof file.path !== "string" || typeof file.content !== "string") {
        return c.json({
          error: "invalid_request",
          error_description:
            "Each file must have path (string) and content (base64 string)",
        }, 400);
      }

      // Normalize path: strip leading slashes, reject traversal
      const normalizedPath = file.path.replace(/^\/+/, "");
      if (
        !normalizedPath || normalizedPath.includes("..") ||
        normalizedPath.startsWith("/")
      ) {
        return c.json({
          error: "invalid_request",
          error_description: `Invalid file path: ${file.path}`,
        }, 400);
      }

      let contentBytes: ArrayBuffer;
      try {
        const binaryStr = atob(file.content);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        contentBytes = bytes.buffer;
      } catch {
        return c.json({
          error: "invalid_request",
          error_description: `Invalid base64 content for file: ${file.path}`,
        }, 400);
      }

      const contentType =
        typeof file.contentType === "string" && file.contentType
          ? file.contentType
          : inferContentType(normalizedPath);

      const r2Key = `${appPrefix}${normalizedPath}`;
      await c.env.MEDIA.put(r2Key, contentBytes, {
        httpMetadata: { contentType },
      });

      results.push({ path: normalizedPath, status: "uploaded" });
    }

    const appUrl = c.env.APP_URL ?? `https://${new URL(c.req.url).host}`;
    const deployedUrl = `${appUrl}/hosted/${token.sub}/${appName}/`;

    return c.json({ url: deployedUrl, files: results.length });
  },
);

// Serve routes (mounted at /hosted)

export const appsServeRoutes = new Hono<AppEnv>();

appsServeRoutes.get("/:clientId/:appName/*", async (c) => {
  const clientId = c.req.param("clientId");
  const appName = c.req.param("appName");

  // Extract the wildcard path after /:clientId/:appName/
  const url = new URL(c.req.url);
  const prefix = `/hosted/${clientId}/${appName}/`;
  let filePath = url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length)
    : "";

  if (!filePath || filePath === "/") {
    filePath = "index.html";
  }

  // Security: reject path traversal
  if (filePath.includes("..")) {
    return c.json({ error: "forbidden" }, 403);
  }

  const r2Key = `hosted/${clientId}/${appName}/${filePath}`;

  const object = await c.env.MEDIA.get(r2Key);
  if (object) {
    const contentType = object.httpMetadata?.contentType ??
      inferContentType(filePath);
    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set(
      "Cache-Control",
      filePath.includes("/assets/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600",
    );
    if (object.httpEtag) {
      headers.set("ETag", object.httpEtag);
    }
    return new Response(object.body, { headers });
  }

  // SPA fallback: serve index.html for paths without a file extension
  if (!filePath.includes(".")) {
    const indexKey = `hosted/${clientId}/${appName}/index.html`;
    const indexObject = await c.env.MEDIA.get(indexKey);
    if (indexObject) {
      const headers = new Headers();
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.set("Cache-Control", "no-cache");
      return new Response(indexObject.body, { headers });
    }
  }

  return c.json({ error: "not_found" }, 404);
});

// Redirect /hosted/:clientId/:appName → /hosted/:clientId/:appName/
appsServeRoutes.get("/:clientId/:appName", async (c) => {
  const clientId = c.req.param("clientId");
  const appName = c.req.param("appName");
  return c.redirect(`/hosted/${clientId}/${appName}/`, 301);
});
