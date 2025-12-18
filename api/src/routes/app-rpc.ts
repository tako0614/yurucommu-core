import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import {
  HttpError,
  buildAiProviderRegistry,
  chatCompletion,
  embed,
  mergeTakosAiConfig,
  DEFAULT_TAKOS_AI_CONFIG,
} from "@takos/platform/server";
import { buildCoreServices } from "../lib/core-services";
import { createAppCollectionFactory } from "../lib/app-collections";
import { ErrorCodes } from "../lib/error-codes";
import type { AppAuthContext } from "@takos/platform/app/runtime/types";
import { requireAiQuota } from "../lib/plan-guard";
import { createUsageTrackerFromEnv } from "../lib/usage-tracker";
import { ensureAiCallAllowed } from "../lib/ai-rate-limit";
import { ensureOutboundCallAllowed } from "../lib/outbound-rate-limit";
import { createOutboundAuditLogger } from "../lib/outbound-audit";

type RpcRequest =
  | {
      kind: "db";
      collection: string;
      method: string;
      args: unknown[];
      workspaceId?: string | null;
      mode?: "dev" | "prod";
    }
  | {
      kind: "services";
      path: string[];
      args: unknown[];
    }
  | {
      kind: "storage";
      bucket: string;
      method: string;
      args: unknown[];
      workspaceId?: string | null;
      userId?: string | null;
      mode?: "dev" | "prod";
    }
  | {
      kind: "ai";
      method: "chat.completions.create" | "embeddings.create";
      args: unknown[];
      auth?: AppAuthContext | null;
    }
  | {
      kind: "outbound";
      url: string;
      init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: { encoding: "utf8" | "base64"; data: string } | null;
      };
      auth?: AppAuthContext | null;
    };

type RpcResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: { message: string; code?: string; stack?: string } };

function requireRpcToken(env: Bindings, request: Request): void {
  const raw = typeof (env as any).TAKOS_APP_RPC_TOKEN === "string" ? (env as any).TAKOS_APP_RPC_TOKEN : "";
  const expected = raw
    .split(/[,\s]+/g)
    .map((token: string) => token.trim())
    .filter((token: string) => token.length > 0);
  if (expected.length === 0) {
    throw new HttpError(503, ErrorCodes.SERVICE_UNAVAILABLE, "TAKOS_APP_RPC_TOKEN is not configured");
  }
  const provided =
    request.headers.get("x-takos-app-rpc-token") ??
    request.headers.get("X-Takos-App-Rpc-Token") ??
    "";
  const token = provided.trim();
  if (!token || !expected.includes(token)) {
    throw new HttpError(403, ErrorCodes.FORBIDDEN, "Invalid app RPC token");
  }
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePath(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((segment) => (typeof segment === "string" ? segment.trim() : ""))
    .filter((segment) => segment.length > 0);
}

function normalizeArgs(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeMode(value: unknown): "dev" | "prod" {
  return value === "dev" ? "dev" : "prod";
}

function isDevEnvironment(env: unknown): boolean {
  const raw =
    typeof (env as any)?.ENVIRONMENT === "string"
      ? (env as any).ENVIRONMENT
      : typeof (env as any)?.NODE_ENV === "string"
        ? (env as any).NODE_ENV
        : "";
  return raw.trim().toLowerCase() === "development";
}

function isSafePropertyName(value: string): boolean {
  if (!value) return false;
  return value !== "__proto__" && value !== "prototype" && value !== "constructor";
}

const ALLOWED_SERVICE_ROOTS = new Set([
  "objects",
  "actors",
  "notifications",
  "storage",
]);

const isOutboundEnabled = (env: Bindings): boolean => {
  const raw = typeof (env as any)?.TAKOS_OUTBOUND_RPC_ENABLED === "string" ? (env as any).TAKOS_OUTBOUND_RPC_ENABLED : "";
  return raw.trim().toLowerCase() === "true" || raw.trim() === "1";
};

const normalizeHeadersRecord = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const headers: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(input)) {
    const name = typeof key === "string" ? key.trim() : "";
    if (!name) continue;
    if (!/^[A-Za-z0-9-]+$/.test(name)) continue;
    const headerValue = typeof rawValue === "string" ? rawValue : rawValue == null ? "" : String(rawValue);
    headers[name] = headerValue;
  }
  return headers;
};

const parseOutboundUrl = (value: unknown): URL => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw new Error("url is required");
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("only http/https urls are allowed");
  }
  return url;
};

const isLoopbackHost = (hostname: string): boolean => {
  const host = hostname.trim().toLowerCase();
  return host === "localhost" || host === "takos.internal" || host.endsWith(".local");
};

const parseIpv4 = (hostname: string): number[] | null => {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number.parseInt(part, 10);
    if (n < 0 || n > 255) return null;
    octets.push(n);
  }
  return octets;
};

const isPrivateIpv4 = (octets: number[]): boolean => {
  const [a, b] = octets;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10/8
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 169 && b === 254) return true; // link-local
  if (a === 0) return true;
  return false;
};

const isPrivateIpv6 = (hostname: string): boolean => {
  const h = hostname.toLowerCase();
  if (h === "::1") return true;
  if (h.startsWith("fe80:")) return true; // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local
  return false;
};

const normalizeHostname = (hostname: string): string => hostname.trim().toLowerCase().replace(/^\*\./, "");

const matchesBlockedInstances = (hostname: string, config: any): boolean => {
  const normalized = normalizeHostname(hostname);
  const list = Array.isArray(config?.activitypub?.blocked_instances)
    ? config.activitypub.blocked_instances.map((v: any) => (typeof v === "string" ? normalizeHostname(v) : "")).filter(Boolean)
    : [];
  if (!list.length) return false;
  return list.includes(normalized);
};

type KvLike = {
  get: (key: string, type?: "text") => Promise<string | null>;
  put: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
  list: (options: { prefix: string; cursor?: string }) => Promise<{ keys: Array<{ name: string }>; cursor?: string }>;
};

type StoragePutBody = { encoding: "utf8" | "base64"; data: string };
type StoragePutOptions = { contentType?: string; metadata?: Record<string, string>; cacheControl?: string };
type StorageListOptions = { prefix?: string; limit?: number; cursor?: string };

type StorageObject = {
  key: string;
  size: number;
  etag?: string;
  lastModified?: string;
  contentType?: string;
  metadata?: Record<string, string>;
};

type StorageListResult = { objects: StorageObject[]; cursor?: string; truncated: boolean };

const quotePrefix = (value: string): string => value.replace(/\\/g, "/");

const normalizeStorageKey = (value: unknown): string => {
  const raw = typeof value === "string" ? value : "";
  const trimmed = quotePrefix(raw).trim().replace(/^\/+/, "");
  if (!trimmed) throw new Error("storage key is required");
  const parts = trimmed.split("/").filter(Boolean);
  for (const part of parts) {
    if (part === "." || part === "..") {
      throw new Error("storage key cannot contain dot segments");
    }
  }
  return parts.join("/");
};

const sanitizeKeySegment = (value: string): string => {
  const cleaned = (value || "").toString().trim().replace(/[^A-Za-z0-9_:-]+/g, "_");
  const collapsed = cleaned.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return collapsed || "x";
};

const resolveStoragePrefix = (options: {
  appId: string;
  bucket: string;
  workspaceId?: string | null;
  userId?: string | null;
}): string => {
  if (!options.bucket.startsWith("app:")) {
    throw new Error(`Storage bucket name must start with "app:" prefix. Got: "${options.bucket}"`);
  }
  const bucketId = options.bucket.slice("app:".length).trim();
  if (!bucketId) {
    throw new Error(`Storage bucket name must include an id after "app:". Got: "${options.bucket}"`);
  }
  const scope = options.userId ? `user:${sanitizeKeySegment(options.userId)}` : "global";
  const workspacePart = options.workspaceId ? `ws:${sanitizeKeySegment(options.workspaceId)}` : "ws:prod";
  return `takos:app:${sanitizeKeySegment(options.appId)}:storage:${workspacePart}:${scope}:${sanitizeKeySegment(bucketId)}:`;
};

const toBytes = (body: StoragePutBody): Uint8Array => {
  if (body.encoding === "utf8") {
    return new TextEncoder().encode(body.data);
  }
  // base64
  if (typeof atob === "function") {
    const bin = atob(body.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  // @ts-ignore Buffer is available in Node.js / tests
  if (typeof Buffer !== "undefined") {
    // @ts-ignore Buffer is available in Node.js / tests
    return new Uint8Array(Buffer.from(body.data, "base64"));
  }
  throw new Error("Base64 decoding is not supported in this environment");
};

const toBase64 = (bytes: Uint8Array): string => {
  if (typeof btoa === "function") {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  // @ts-ignore Buffer is available in Node.js / tests
  if (typeof Buffer !== "undefined") {
    // @ts-ignore Buffer is available in Node.js / tests
    return Buffer.from(bytes).toString("base64");
  }
  throw new Error("Base64 encoding is not supported in this environment");
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const getKv = (env: Bindings): KvLike | null => {
  const kv = (env as any).APP_STATE || (env as any).KV;
  if (!kv?.get || !kv?.put || !kv?.delete || !kv?.list) return null;
  return kv as KvLike;
};

const readResponseBodyBase64 = async (response: Response, limitBytes = 1024 * 1024): Promise<{ encoding: "base64"; data: string } | null> => {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const n = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(n) && n > limitBytes) {
      throw new Error("outbound response body exceeds size limit");
    }
  }
  const buf = await response.arrayBuffer();
  if (buf.byteLength > limitBytes) {
    throw new Error("outbound response body exceeds size limit");
  }
  return { encoding: "base64", data: toBase64(new Uint8Array(buf)) };
};

export const appRpcRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

appRpcRoutes.post("/-/internal/app-rpc", async (c) => {
  requireRpcToken(c.env as any, c.req.raw);
  const payload = (await c.req.json().catch(() => null)) as RpcRequest | null;
  if (!payload || typeof payload !== "object") {
    return c.json({ ok: false, error: { message: "invalid payload" } } satisfies RpcResponse, 400);
  }

  try {
    if (payload.kind === "db") {
      const collection = normalizeString((payload as any).collection);
      const method = normalizeString((payload as any).method);
      const args = normalizeArgs((payload as any).args);
      const workspaceId = normalizeString((payload as any).workspaceId) || null;
      const mode = normalizeMode((payload as any).mode);

      if (!collection || !method) {
        return c.json({ ok: false, error: { message: "collection and method are required" } } satisfies RpcResponse, 400);
      }
      if (!collection.startsWith("app:")) {
        return c.json(
          { ok: false, error: { message: `Collection name must start with "app:" prefix. Got: "${collection}"` } } satisfies RpcResponse,
          400,
        );
      }
      if (!isSafePropertyName(method)) {
        return c.json(
          { ok: false, error: { message: `Invalid db method "${method}"` } } satisfies RpcResponse,
          400,
        );
      }
      if (workspaceId && mode !== "dev") {
        return c.json(
          { ok: false, error: { message: "workspaceId is only allowed in dev mode" } } satisfies RpcResponse,
          400,
        );
      }

      const factory = createAppCollectionFactory(c.env as any, "active", workspaceId);
      const target = factory(collection);
      const fn = (target as any)[method];
      if (typeof fn !== "function") {
        return c.json({ ok: false, error: { message: `Unknown db method "${method}"` } } satisfies RpcResponse, 400);
      }
      const result = await fn.apply(target, args);
      return c.json({ ok: true, result } satisfies RpcResponse);
    }

    if (payload.kind === "services") {
      const path = normalizePath((payload as any).path);
      const args = normalizeArgs((payload as any).args);
      if (path.length < 2) {
        return c.json({ ok: false, error: { message: "services path must include service and method" } } satisfies RpcResponse, 400);
      }
      if (!path.every(isSafePropertyName)) {
        return c.json(
          { ok: false, error: { message: "services path contains invalid segment" } } satisfies RpcResponse,
          400,
        );
      }
      const root = path[0];
      if (!ALLOWED_SERVICE_ROOTS.has(root)) {
        return c.json(
          { ok: false, error: { message: `Service "${root}" is not available to apps`, code: ErrorCodes.FORBIDDEN } } satisfies RpcResponse,
          403,
        );
      }
      const services = buildCoreServices(c.env as any) as any;
      let target: any = services;
      for (const segment of path.slice(0, -1)) {
        target = target?.[segment];
      }
      const methodName = path[path.length - 1];
      const fn = target?.[methodName];
      if (typeof fn !== "function") {
        return c.json({ ok: false, error: { message: `Unknown service method "${path.join(".")}"` } } satisfies RpcResponse, 400);
      }
      const result = await fn.apply(target, args);
      return c.json({ ok: true, result } satisfies RpcResponse);
    }

    if (payload.kind === "storage") {
      const bucket = normalizeString((payload as any).bucket);
      const method = normalizeString((payload as any).method);
      const args = normalizeArgs((payload as any).args);
      const workspaceId = normalizeString((payload as any).workspaceId) || null;
      const userId = normalizeString((payload as any).userId) || null;
      const mode = normalizeMode((payload as any).mode);

      if (!bucket || !method) {
        return c.json({ ok: false, error: { message: "bucket and method are required" } } satisfies RpcResponse, 400);
      }
      if (!bucket.startsWith("app:")) {
        return c.json(
          { ok: false, error: { message: `Storage bucket name must start with "app:" prefix. Got: "${bucket}"` } } satisfies RpcResponse,
          400,
        );
      }
      if (!isSafePropertyName(method)) {
        return c.json(
          { ok: false, error: { message: `Invalid storage method "${method}"` } } satisfies RpcResponse,
          400,
        );
      }
      if (workspaceId && mode !== "dev") {
        return c.json(
          { ok: false, error: { message: "workspaceId is only allowed in dev mode" } } satisfies RpcResponse,
          400,
        );
      }

      const kv = getKv(c.env as any);
      if (!kv) {
        throw new HttpError(503, ErrorCodes.SERVICE_UNAVAILABLE, "APP_STATE/KV binding is not configured");
      }

      const prefix = resolveStoragePrefix({ appId: "active", bucket, workspaceId, userId });
      const objectKey = (...parts: string[]) => `${prefix}${parts.join(":")}`;

      const resolveDataKey = (key: string) => objectKey("data", key);
      const resolveMetaKey = (key: string) => objectKey("meta", key);

      if (method === "put") {
        const [rawKey, rawBody, rawOptions] = args;
        let key: string;
        try {
          key = normalizeStorageKey(rawKey);
        } catch (error) {
          const message = error instanceof Error ? error.message : "invalid storage key";
          return c.json({ ok: false, error: { message } } satisfies RpcResponse, 400);
        }
        const body = rawBody as StoragePutBody;
        const options = (rawOptions ?? {}) as StoragePutOptions;
        if (!body || (body.encoding !== "utf8" && body.encoding !== "base64") || typeof body.data !== "string") {
          return c.json({ ok: false, error: { message: "invalid storage body" } } satisfies RpcResponse, 400);
        }
        const bytes = toBytes(body);
        const etag = await sha256Hex(bytes);
        const size = bytes.byteLength;
        const lastModified = new Date().toISOString();
        const contentType = typeof options.contentType === "string" ? options.contentType : undefined;
        const metadata = options.metadata && typeof options.metadata === "object" ? options.metadata : undefined;
        const payloadData = JSON.stringify({ encoding: "base64", data: toBase64(bytes) });
        const payloadMeta = JSON.stringify({
          key,
          size,
          etag,
          lastModified,
          contentType,
          metadata,
        } satisfies StorageObject);

        await kv.put(resolveDataKey(key), payloadData);
        await kv.put(resolveMetaKey(key), payloadMeta);

        return c.json({ ok: true, result: JSON.parse(payloadMeta) } satisfies RpcResponse);
      }

      if (method === "get") {
        const [rawKey] = args;
        let key: string;
        try {
          key = normalizeStorageKey(rawKey);
        } catch (error) {
          const message = error instanceof Error ? error.message : "invalid storage key";
          return c.json({ ok: false, error: { message } } satisfies RpcResponse, 400);
        }
        const stored = await kv.get(resolveDataKey(key), "text");
        if (!stored) return c.json({ ok: true, result: null } satisfies RpcResponse);
        const parsed = JSON.parse(stored) as { encoding: string; data: string };
        if (parsed?.encoding !== "base64" || typeof parsed.data !== "string") {
          throw new Error("corrupt storage entry");
        }
        return c.json({ ok: true, result: { encoding: "base64", data: parsed.data } } satisfies RpcResponse);
      }

      if (method === "getText") {
        const [rawKey] = args;
        let key: string;
        try {
          key = normalizeStorageKey(rawKey);
        } catch (error) {
          const message = error instanceof Error ? error.message : "invalid storage key";
          return c.json({ ok: false, error: { message } } satisfies RpcResponse, 400);
        }
        const stored = await kv.get(resolveDataKey(key), "text");
        if (!stored) return c.json({ ok: true, result: null } satisfies RpcResponse);
        const parsed = JSON.parse(stored) as { encoding: string; data: string };
        if (parsed?.encoding !== "base64" || typeof parsed.data !== "string") {
          throw new Error("corrupt storage entry");
        }
        const bytes = toBytes({ encoding: "base64", data: parsed.data });
        const text = new TextDecoder().decode(bytes);
        return c.json({ ok: true, result: text } satisfies RpcResponse);
      }

      if (method === "head") {
        const [rawKey] = args;
        let key: string;
        try {
          key = normalizeStorageKey(rawKey);
        } catch (error) {
          const message = error instanceof Error ? error.message : "invalid storage key";
          return c.json({ ok: false, error: { message } } satisfies RpcResponse, 400);
        }
        const stored = await kv.get(resolveMetaKey(key), "text");
        if (!stored) return c.json({ ok: true, result: null } satisfies RpcResponse);
        return c.json({ ok: true, result: JSON.parse(stored) } satisfies RpcResponse);
      }

      if (method === "delete") {
        const [rawKey] = args;
        let key: string;
        try {
          key = normalizeStorageKey(rawKey);
        } catch (error) {
          const message = error instanceof Error ? error.message : "invalid storage key";
          return c.json({ ok: false, error: { message } } satisfies RpcResponse, 400);
        }
        const exists = !!(await kv.get(resolveMetaKey(key), "text"));
        await kv.delete(resolveMetaKey(key));
        await kv.delete(resolveDataKey(key));
        return c.json({ ok: true, result: exists } satisfies RpcResponse);
      }

      if (method === "deleteMany") {
        const [rawKeys] = args;
        const keys = Array.isArray(rawKeys) ? rawKeys : [];
        let deleted = 0;
        for (const entry of keys) {
          let key: string;
          try {
            key = normalizeStorageKey(entry);
          } catch (error) {
            const message = error instanceof Error ? error.message : "invalid storage key";
            return c.json({ ok: false, error: { message } } satisfies RpcResponse, 400);
          }
          const exists = !!(await kv.get(resolveMetaKey(key), "text"));
          await kv.delete(resolveMetaKey(key));
          await kv.delete(resolveDataKey(key));
          if (exists) deleted += 1;
        }
        return c.json({ ok: true, result: deleted } satisfies RpcResponse);
      }

      if (method === "list") {
        const [rawOptions] = args;
        const options = (rawOptions ?? {}) as StorageListOptions;
        const listPrefix =
          typeof options.prefix === "string"
            ? options.prefix.trim() === ""
              ? ""
              : (() => {
                  try {
                    return normalizeStorageKey(options.prefix);
                  } catch {
                    return null;
                  }
                })()
            : "";
        if (listPrefix === null) {
          return c.json({ ok: false, error: { message: "invalid list prefix" } } satisfies RpcResponse, 400);
        }
        const limit = typeof options.limit === "number" && options.limit > 0 ? Math.trunc(options.limit) : 100;
        const cursor = typeof options.cursor === "string" ? options.cursor : undefined;
        const res = await kv.list({ prefix: `${prefix}meta:${listPrefix}`, cursor });
        const objects: StorageObject[] = [];
        for (const keyEntry of res.keys.slice(0, limit)) {
          const name = keyEntry.name;
          const storageKey = name.startsWith(`${prefix}meta:`) ? name.slice(`${prefix}meta:`.length) : "";
          if (!storageKey) continue;
          const meta = await kv.get(name, "text");
          if (!meta) continue;
          try {
            objects.push(JSON.parse(meta) as StorageObject);
          } catch {
            objects.push({ key: storageKey, size: 0 });
          }
        }
        const result: StorageListResult = { objects, cursor: res.cursor, truncated: objects.length >= limit };
        return c.json({ ok: true, result } satisfies RpcResponse);
      }

      return c.json({ ok: false, error: { message: `Unknown storage method "${method}"` } } satisfies RpcResponse, 400);
    }

    if (payload.kind === "ai") {
      const method = normalizeString((payload as any).method);
      const args = normalizeArgs((payload as any).args);
      const auth = ((payload as any).auth ?? null) as AppAuthContext | null;

      const userId = typeof auth?.userId === "string" ? auth.userId : null;
      if (!auth?.isAuthenticated || !userId) {
        return c.json(
          { ok: false, error: { message: "authentication required", code: ErrorCodes.FORBIDDEN } } satisfies RpcResponse,
          403,
        );
      }

      const takosConfig = ((c.get?.("takosConfig") as any) ?? (c.env as any).takosConfig) as any;
      if (!takosConfig) {
        return c.json(
          { ok: false, error: { message: "takos-config is not available", code: ErrorCodes.SERVICE_UNAVAILABLE } } satisfies RpcResponse,
          503,
        );
      }

      const aiConfig = mergeTakosAiConfig(DEFAULT_TAKOS_AI_CONFIG, takosConfig.ai ?? {});
      if (aiConfig.enabled === false) {
        return c.json(
          { ok: false, error: { message: "AI is disabled for this node", code: ErrorCodes.FORBIDDEN } } satisfies RpcResponse,
          403,
        );
      }
      if (aiConfig.requires_external_network === false) {
        return c.json(
          { ok: false, error: { message: "AI external network access is disabled for this node", code: ErrorCodes.SERVICE_UNAVAILABLE } } satisfies RpcResponse,
          503,
        );
      }

      const usageTracker = createUsageTrackerFromEnv(c.env as any);
      const currentUsage = await usageTracker.getAiUsage(userId);
      const planCheck = requireAiQuota(auth as any, { used: currentUsage, requested: 1 });
      if (!planCheck.ok) {
        return c.json(
          { ok: false, error: { message: planCheck.message, code: planCheck.code } } satisfies RpcResponse,
          planCheck.status,
        );
      }

      const rateLimit = await ensureAiCallAllowed(c.env as any, auth as any, {});
      if (!rateLimit.ok) {
        return c.json(
          { ok: false, error: { message: rateLimit.message, code: rateLimit.code } } satisfies RpcResponse,
          rateLimit.status,
        );
      }

      let providers;
      try {
        providers = buildAiProviderRegistry(aiConfig, c.env as any);
      } catch (error: any) {
        return c.json(
          { ok: false, error: { message: error?.message || "failed to resolve AI providers" } } satisfies RpcResponse,
          400,
        );
      }

      const provider = providers.get();
      if (!provider) {
        return c.json({ ok: false, error: { message: "No AI provider configured" } } satisfies RpcResponse, 503);
      }

      if (method === "chat.completions.create") {
        const params = (args?.[0] ?? {}) as any;
        if (params?.stream) {
          return c.json({ ok: false, error: { message: "streaming is not supported via app-rpc" } } satisfies RpcResponse, 400);
        }

        const messages = Array.isArray(params?.messages)
          ? params.messages.map((m: any) => ({
              role: m.role,
              content: m.content,
              tool_calls: (m as any)?.tool_calls,
              tool_call_id: (m as any)?.tool_call_id,
            }))
          : [];

        const result = await chatCompletion(provider, messages, {
          model: params.model,
          temperature: params.temperature,
          maxTokens: params.max_tokens,
          stream: false,
          tools: params.tools,
          toolChoice: params.tool_choice,
          responseFormat: params.response_format,
        });

        await usageTracker.recordAiRequest(userId);

        return c.json(
          {
            ok: true,
            result: {
              id: result.id,
              choices: result.choices.map((choice) => ({
                index: choice.index,
                message: choice.message as any,
                finish_reason: choice.finishReason ?? "stop",
              })),
              usage: result.usage
                ? {
                    prompt_tokens: result.usage.promptTokens,
                    completion_tokens: result.usage.completionTokens,
                    total_tokens: result.usage.totalTokens,
                  }
                : undefined,
            },
          } satisfies RpcResponse,
        );
      }

      if (method === "embeddings.create") {
        const params = (args?.[0] ?? {}) as any;
        const result = await embed(provider, params?.input ?? "", { model: params?.model });

        await usageTracker.recordAiRequest(userId);

        return c.json(
          {
            ok: true,
            result: {
              data: result.embeddings.map((entry) => ({ index: entry.index, embedding: entry.embedding })),
              usage: result.usage
                ? { prompt_tokens: result.usage.promptTokens, total_tokens: result.usage.totalTokens }
                : undefined,
            },
          } satisfies RpcResponse,
        );
      }

      return c.json(
        { ok: false, error: { message: `Unknown AI method "${method}"` } } satisfies RpcResponse,
        400,
      );
    }

    if (payload.kind === "outbound") {
      const audit = createOutboundAuditLogger(c.env as any);
      const startedAt = Date.now();

      if (!isOutboundEnabled(c.env as any)) {
        await audit({
          status: "blocked",
          url: String((payload as any)?.url ?? ""),
          method: String(((payload as any)?.init as any)?.method ?? "GET"),
          reason: "disabled",
          durationMs: Date.now() - startedAt,
        });
        return c.json(
          { ok: false, error: { message: "Outbound RPC is disabled", code: ErrorCodes.FORBIDDEN } } satisfies RpcResponse,
          403,
        );
      }

      const auth = (payload as any).auth as AppAuthContext | null | undefined;
      if (auth?.isAuthenticated) {
        await audit({
          status: "blocked",
          url: String((payload as any)?.url ?? ""),
          method: String(((payload as any)?.init as any)?.method ?? "GET"),
          reason: "auth_required",
          durationMs: Date.now() - startedAt,
        });
        return c.json(
          { ok: false, error: { message: "Outbound RPC is only available for background jobs", code: ErrorCodes.FORBIDDEN } } satisfies RpcResponse,
          403,
        );
      }

      const url = parseOutboundUrl((payload as any).url);
      const hostname = url.hostname;

      if (isLoopbackHost(hostname)) {
        await audit({
          status: "blocked",
          url: url.toString(),
          hostname,
          method: String(((payload as any)?.init as any)?.method ?? "GET"),
          reason: "loopback",
          durationMs: Date.now() - startedAt,
        });
        return c.json(
          { ok: false, error: { message: "Outbound URL host is not allowed", code: ErrorCodes.FORBIDDEN } } satisfies RpcResponse,
          403,
        );
      }

      const ipv4 = parseIpv4(hostname);
      if (ipv4 && isPrivateIpv4(ipv4)) {
        await audit({
          status: "blocked",
          url: url.toString(),
          hostname,
          method: String(((payload as any)?.init as any)?.method ?? "GET"),
          reason: "private_ip",
          durationMs: Date.now() - startedAt,
        });
        return c.json(
          { ok: false, error: { message: "Outbound URL host is not allowed", code: ErrorCodes.FORBIDDEN } } satisfies RpcResponse,
          403,
        );
      }
      if (!ipv4 && hostname.includes(":") && isPrivateIpv6(hostname)) {
        await audit({
          status: "blocked",
          url: url.toString(),
          hostname,
          method: String(((payload as any)?.init as any)?.method ?? "GET"),
          reason: "private_ip",
          durationMs: Date.now() - startedAt,
        });
        return c.json(
          { ok: false, error: { message: "Outbound URL host is not allowed", code: ErrorCodes.FORBIDDEN } } satisfies RpcResponse,
          403,
        );
      }

      const takosConfig = ((c.get?.("takosConfig") as any) ?? (c.env as any).takosConfig) as any;
      if (takosConfig && matchesBlockedInstances(hostname, takosConfig)) {
        await audit({
          status: "blocked",
          url: url.toString(),
          hostname,
          method: String(((payload as any)?.init as any)?.method ?? "GET"),
          reason: "blocked_instances",
          durationMs: Date.now() - startedAt,
        });
        return c.json(
          { ok: false, error: { message: "Outbound URL host is blocked by federation policy", code: ErrorCodes.FORBIDDEN } } satisfies RpcResponse,
          403,
        );
      }

      const rateLimit = await ensureOutboundCallAllowed(c.env as any, auth, { actorKey: "app-scheduled" });
      if (!rateLimit.ok) {
        await audit({
          status: "blocked",
          url: url.toString(),
          hostname,
          method: String(((payload as any)?.init as any)?.method ?? "GET"),
          reason: rateLimit.code,
          durationMs: Date.now() - startedAt,
        });
        return c.json(
          { ok: false, error: { message: rateLimit.message, code: rateLimit.code } } satisfies RpcResponse,
          rateLimit.status,
        );
      }

      const init = (payload as any).init ?? {};
      const methodRaw = typeof init?.method === "string" ? init.method.trim().toUpperCase() : "GET";
      const method = methodRaw || "GET";
      if (!/^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH)$/.test(method)) {
        await audit({
          status: "blocked",
          url: url.toString(),
          hostname,
          method,
          reason: "invalid_method",
          durationMs: Date.now() - startedAt,
        });
        return c.json(
          { ok: false, error: { message: "invalid outbound method" } } satisfies RpcResponse,
          400,
        );
      }

      const headers = normalizeHeadersRecord(init?.headers);
      const body = init?.body as { encoding: "utf8" | "base64"; data: string } | null | undefined;
      let outboundBody: BodyInit | undefined;
      if (body) {
        if (body.encoding === "utf8") {
          outboundBody = body.data;
        } else if (body.encoding === "base64") {
          outboundBody = toBytes({ encoding: "base64", data: body.data });
        } else {
          await audit({
            status: "blocked",
            url: url.toString(),
            hostname,
            method,
            reason: "invalid_body",
            durationMs: Date.now() - startedAt,
          });
          return c.json({ ok: false, error: { message: "invalid outbound body" } } satisfies RpcResponse, 400);
        }
      }

      try {
        await audit({
          status: "attempt",
          url: url.toString(),
          hostname,
          method,
          durationMs: Date.now() - startedAt,
        });

        const response = await fetch(url.toString(), {
          method,
          headers,
          body: outboundBody,
        });

        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of response.headers.entries()) {
          responseHeaders[key] = value;
        }

        const responseBody = await readResponseBodyBase64(response);
        const responseBytes =
          responseBody && responseBody.encoding === "base64" && typeof responseBody.data === "string"
            ? Math.floor((responseBody.data.length * 3) / 4)
            : 0;

        await audit({
          status: "success",
          url: url.toString(),
          hostname,
          method,
          httpStatus: response.status,
          durationMs: Date.now() - startedAt,
          responseBytes,
        });

        return c.json(
          {
            ok: true,
            result: {
              url: url.toString(),
              status: response.status,
              headers: responseHeaders,
              body: responseBody,
            },
          } satisfies RpcResponse,
        );
      } catch (error: any) {
        await audit({
          status: "error",
          url: url.toString(),
          hostname,
          method,
          reason: error?.message || "outbound_failed",
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    }

    return c.json({ ok: false, error: { message: "unknown kind" } } satisfies RpcResponse, 400);
  } catch (error) {
    const isDev = isDevEnvironment(c.env);
    const status = error instanceof HttpError ? error.status : 500;
    const code = error instanceof HttpError ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error ?? "rpc_failed");
    const stack = isDev && error instanceof Error ? error.stack : undefined;
    return c.json({ ok: false, error: { message, code, stack } } satisfies RpcResponse, status);
  }
});

export default appRpcRoutes;
