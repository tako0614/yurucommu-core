import { build, stop } from "esbuild";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

type StaticAsset = {
  contentType: string;
  body: string;
};

const distDir = new URL("../dist/", import.meta.url);
const tempEntryFile = new URL("../dist/takos-entry.generated.ts", import.meta.url);
const outputFile = new URL("../dist/takos-worker.js", import.meta.url);

function contentTypeFor(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".woff")) return "font/woff";
  if (path.endsWith(".ttf")) return "font/ttf";
  if (path.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

async function collectAssets(
  dir: URL,
  assets: Record<string, StaticAsset>,
  prefix = "",
): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relativePath = `${prefix}${entry.name}`;
    const url = new URL(entry.name, dir);
    if (entry.isDirectory()) {
      await collectAssets(new URL(`${entry.name}/`, dir), assets, `${relativePath}/`);
      continue;
    }
    if (
      !entry.isFile() ||
      relativePath === "takos-worker.js" ||
      relativePath === "takos-entry.generated.ts"
    ) {
      continue;
    }

    const bytes = await readFile(url);
    assets[relativePath] = {
      contentType: contentTypeFor(relativePath),
      body: bytesToBase64(bytes),
    };
  }
}

async function run(command: string[], cwd: URL): Promise<void> {
  const child = Bun.spawn(command, {
    cwd: fileURLToPath(cwd),
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) {
    throw new Error(`Command failed: ${command.join(" ")}`);
  }
}

export function createEntrySource(assets: Record<string, StaticAsset>): string {
  return `import { backendApp, handleYurucommuQueueBatch } from "../src/backend/index.ts";
import { wrapCloudflareBindings } from "../src/backend/runtime/cloudflare.ts";
import type { Env, EnvVars } from "../src/backend/types.ts";
import type {
  DeliveryDlqMessageV1,
  DeliveryQueueMessageV1,
} from "../src/backend/lib/delivery/types.ts";
import type {
  D1Database,
  Fetcher,
  KVNamespace,
  MessageBatch,
  Queue,
  R2Bucket,
} from "@cloudflare/workers-types";

type RuntimeEnv = Omit<Env, "ASSETS"> & { ASSETS?: Fetcher };
type WorkerBindings = EnvVars & {
  DB: D1Database;
  MEDIA?: R2Bucket;
  KV: KVNamespace;
  ASSETS?: Fetcher;
  DELIVERY_QUEUE?: Queue<DeliveryQueueMessageV1>;
  DELIVERY_DLQ?: Queue<DeliveryDlqMessageV1>;
};

const EMBEDDED_ASSETS = ${JSON.stringify(assets, null, 2)};

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function isNavigationRequest(request: Request): boolean {
  return (request.method === "GET" || request.method === "HEAD") &&
    (request.headers.get("accept") ?? "").includes("text/html");
}

function hasFileExtension(pathname: string): boolean {
  const segment = pathname.split("/").pop() ?? "";
  return segment.includes(".");
}

function resolveAssetPath(request: Request): string {
  const url = new URL(request.url);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "" || pathname === "/") return "index.html";
  if (pathname.endsWith("/")) pathname += "index.html";
  return pathname.startsWith("/") ? pathname.slice(1) : pathname;
}

function createAssetResponse(assetPath: string, request: Request): Response {
  const asset = EMBEDDED_ASSETS[assetPath];
  if (!asset) {
    return new Response("Not found", { status: 404 });
  }

  const body = request.method === "HEAD" ? null : decodeBase64(asset.body);
  return new Response(body, {
    headers: {
      "content-type": asset.contentType,
      "cache-control": assetPath === "index.html"
        ? "no-cache"
        : "public, max-age=31536000, immutable",
    },
  });
}

const embeddedAssetsFetcher: Fetcher = {
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : new Request(input, init);
    const assetPath = resolveAssetPath(request);
    const resolvedAsset = EMBEDDED_ASSETS[assetPath]
      ? assetPath
      : (!hasFileExtension(assetPath) && isNavigationRequest(request))
      ? "index.html"
      : undefined;

    if (!resolvedAsset) {
      return new Response("Not found", { status: 404 });
    }
    return createAssetResponse(resolvedAsset, request);
  },
};

function withDefaultAppUrl(request: Request, env: RuntimeEnv): RuntimeEnv {
  if (typeof env.APP_URL === "string" && env.APP_URL.trim().length > 0) {
    return env;
  }
  return { ...env, APP_URL: new URL(request.url).origin };
}

export default {
  async fetch(
    request: Request,
    env: WorkerBindings,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const envWithAppUrl = withDefaultAppUrl(request, wrapCloudflareBindings(env));
    const runtimeEnv = envWithAppUrl.ASSETS
      ? envWithAppUrl
      : { ...envWithAppUrl, ASSETS: embeddedAssetsFetcher };
    return backendApp.fetch(request, runtimeEnv as Env, ctx);
  },

  async queue(
    batch: MessageBatch<DeliveryQueueMessageV1 | DeliveryDlqMessageV1>,
    env: WorkerBindings,
  ): Promise<void> {
    return handleYurucommuQueueBatch(batch, wrapCloudflareBindings(env) as Env);
  },
};
`;
}

export async function main(): Promise<void> {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  const assets: Record<string, StaticAsset> = {};
  await writeFile(tempEntryFile, createEntrySource(assets));

  try {
    await build({
      entryPoints: [tempEntryFile.pathname],
      outfile: outputFile.pathname,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      conditions: ["workerd", "worker", "browser"],
      external: ["cloudflare:*", "node:*"],
    });
  } finally {
    stop();
    await rm(tempEntryFile).catch(() => undefined);
  }
}

if (import.meta.main) {
  await main();
}
