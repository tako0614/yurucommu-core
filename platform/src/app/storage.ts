import type {
  KVNamespace,
  KVNamespaceGetOptions,
  KVNamespacePutOptions,
  R2Bucket,
  R2GetOptions,
  R2PutOptions,
} from "@cloudflare/workers-types";
import type { AppBucketDefinition } from "./types";

export type StorageEngine = "r2" | "kv";

type R2PutValue =
  | ReadableStream
  | ArrayBuffer
  | ArrayBufferView
  | string
  | null
  | Blob;

export type StorageTemplateContext = Record<string, string | number | null | undefined>;

export type AppStorageBinding =
  | { type: "r2"; binding: R2Bucket }
  | { type: "kv"; binding: KVNamespace }
  | R2Bucket
  | KVNamespace;

type ResolvedBinding = {
  type: StorageEngine;
  binding: R2Bucket | KVNamespace;
  name?: string;
};

type BucketConfig = {
  id: string;
  basePath: string;
  allowedMime: string[];
  maxSizeBytes: number | null;
  engine: StorageEngine | null;
  bindingName?: string;
  binding?: ResolvedBinding | null;
};

export type AppStoragePutOptions = {
  context?: StorageTemplateContext;
  contentType?: string;
  size?: number;
  r2?: R2PutOptions;
  kv?: KVNamespacePutOptions;
};

export type AppStorageGetOptions = {
  context?: StorageTemplateContext;
  type?: "text" | "arrayBuffer";
  r2?: R2GetOptions;
  kv?: KVNamespaceGetOptions<"text" | "arrayBuffer">;
};

export type AppStorageBucket = {
  resolveKey(key: string, context?: StorageTemplateContext): string;
  put(
    key: string,
    value: R2PutValue,
    options?: AppStoragePutOptions,
  ): Promise<{ key: string; type: StorageEngine }>;
  get(
    key: string,
    options?: AppStorageGetOptions,
  ): Promise<{ key: string; type: StorageEngine; value: unknown }>;
  delete(key: string, options?: { context?: StorageTemplateContext }): Promise<void>;
};

export type AppStorage = {
  hasBucket(id: string): boolean;
  bucket(id: string): AppStorageBucket;
  listBuckets(): string[];
};

export class AppStorageError extends Error {
  code:
    | "bucket_not_found"
    | "binding_missing"
    | "invalid_binding"
    | "invalid_mime"
    | "content_type_required"
    | "max_size_exceeded"
    | "max_size_unknown"
    | "missing_context"
    | "invalid_key";

  constructor(
    code:
      | "bucket_not_found"
      | "binding_missing"
      | "invalid_binding"
      | "invalid_mime"
      | "content_type_required"
      | "max_size_exceeded"
      | "max_size_unknown"
      | "missing_context"
      | "invalid_key",
    message: string,
  ) {
    super(message);
    this.name = "AppStorageError";
    this.code = code;
  }
}

type CreateStorageOptions = {
  buckets?: Record<string, AppBucketDefinition>;
  bindings?: Record<string, AppStorageBinding>;
  defaultContext?: StorageTemplateContext;
};

export function createAppStorage(options: CreateStorageOptions): AppStorage {
  const defaultContext = { ...(options.defaultContext ?? {}) };
  const bindingMap = options.bindings ? new Map(Object.entries(options.bindings)) : new Map();
  const buckets = normalizeBuckets(options.buckets ?? {}, bindingMap);

  const hasBucket = (id: string) => buckets.has(id);

  const listBuckets = () => Array.from(buckets.keys());

  const bucket = (id: string): AppStorageBucket => {
    const config = buckets.get(id);
    if (!config) {
      throw new AppStorageError("bucket_not_found", `Bucket "${id}" is not defined in storage.buckets`);
    }
    const binding =
      config.binding ??
      resolveBinding(
        config.bindingName ? bindingMap.get(config.bindingName) : undefined,
        config.engine,
        config.bindingName,
      ) ??
      null;
    if (!binding) {
      throw new AppStorageError("binding_missing", `No binding provided for bucket "${id}"`);
    }
    if (config.engine && binding.type !== config.engine) {
      throw new AppStorageError(
        "invalid_binding",
        `Bucket "${id}" expects "${config.engine}" binding but received "${binding.type}"`,
      );
    }
    const bucketType = config.engine ?? binding.type;
    const resolveContext = (ctx?: StorageTemplateContext) => ({ ...defaultContext, ...(ctx ?? {}) });

    const resolveKey = (key: string, context?: StorageTemplateContext) =>
      buildKey(config.basePath, key, resolveContext(context));

    const enforceMime = (contentType: string | null | undefined) => {
      if (!config.allowedMime.length) return;
      if (!contentType) {
        throw new AppStorageError("content_type_required", `Bucket "${id}" requires contentType to be specified`);
      }
      if (!mimeAllowed(contentType, config.allowedMime)) {
        throw new AppStorageError(
          "invalid_mime",
          `contentType "${contentType}" is not allowed for bucket "${id}"`,
        );
      }
    };

    const enforceSize = (value: R2PutValue, options?: AppStoragePutOptions) => {
      if (!config.maxSizeBytes) return;
      const size = resolveSize(value, options);
      if (size === null) {
        throw new AppStorageError(
          "max_size_unknown",
          `Unable to determine payload size for bucket "${id}" (max ${config.maxSizeBytes} bytes)`,
        );
      }
      if (size > config.maxSizeBytes) {
        throw new AppStorageError(
          "max_size_exceeded",
          `Payload exceeds max_size_mb for bucket "${id}" (${size} > ${config.maxSizeBytes} bytes)`,
        );
      }
    };

    const put = async (
      key: string,
      value: R2PutValue,
      options?: AppStoragePutOptions,
    ): Promise<{ key: string; type: StorageEngine }> => {
      const fullKey = resolveKey(key, options?.context);
      const contentType = resolveContentType(value, options);
      enforceMime(contentType);
      enforceSize(value, options);

      if (bucketType === "r2") {
        const r2Options = { ...(options?.r2 ?? {}) };
        if (contentType) {
          r2Options.httpMetadata = { ...(r2Options.httpMetadata ?? {}), contentType };
        }
        await (binding.binding as R2Bucket).put(fullKey, value, r2Options);
        return { key: fullKey, type: "r2" };
      }

      const kvValue = await toKvValue(value);
      await (binding.binding as KVNamespace).put(fullKey, kvValue, options?.kv);
      return { key: fullKey, type: "kv" };
    };

    const get = async (
      key: string,
      options?: AppStorageGetOptions,
    ): Promise<{ key: string; type: StorageEngine; value: unknown }> => {
      const fullKey = resolveKey(key, options?.context);
      if (bucketType === "r2") {
        const value = await (binding.binding as R2Bucket).get(fullKey, options?.r2);
        return { key: fullKey, type: "r2", value };
      }
      const kvType = options?.type ?? options?.kv?.type ?? "text";
      const value = await (binding.binding as KVNamespace).get(fullKey, {
        ...(options?.kv ?? {}),
        type: kvType,
      } as any);
      return { key: fullKey, type: "kv", value };
    };

    const del = async (key: string, options?: { context?: StorageTemplateContext }) => {
      const fullKey = resolveKey(key, options?.context);
      if (bucketType === "r2") {
        await (binding.binding as R2Bucket).delete(fullKey);
      } else {
        await (binding.binding as KVNamespace).delete(fullKey);
      }
    };

    return {
      resolveKey,
      put,
      get,
      delete: del,
    };
  };

  return {
    hasBucket,
    bucket,
    listBuckets,
  };
}

function normalizeBuckets(
  buckets: Record<string, AppBucketDefinition>,
  bindings: Map<string, AppStorageBinding>,
): Map<string, BucketConfig> {
  const map = new Map<string, BucketConfig>();
  for (const [id, raw] of Object.entries(buckets)) {
    const engine = parseEngine(pickString(raw, ["engine", "type"]));
    const bindingName = pickString(raw, ["binding", "binding_name", "bindingName"]);
    const binding = resolveBinding(
      bindings.get(id) ?? (bindingName ? bindings.get(bindingName) : undefined),
      engine,
      bindingName,
    );
    map.set(id, {
      id,
      basePath: normalizeBasePath(pickString(raw, ["base_path", "basePath"]) ?? ""),
      allowedMime: normalizeStringArray(pickArray(raw, ["allowed_mime", "allowedMime"])),
      maxSizeBytes: parseMaxSize(pickNumber(raw, ["max_size_mb", "maxSizeMb"])),
      engine,
      bindingName: bindingName || undefined,
      binding,
    });
  }
  return map;
}

function resolveBinding(
  binding: AppStorageBinding | undefined,
  engineHint?: StorageEngine | null,
  name?: string | null,
): ResolvedBinding | null {
  if (!binding) return null;
  const typeFromBinding = parseEngine((binding as any).type);
  const target =
    (binding as any).binding ?? (binding as any).bucket ?? (binding as any).namespace ?? binding;
  const detectedType = detectBindingType(target);
  const resolvedType = typeFromBinding ?? engineHint ?? detectedType;
  if (!resolvedType) return null;
  if (engineHint && detectedType && engineHint !== detectedType) {
    throw new AppStorageError(
      "invalid_binding",
      `Binding "${name || "unknown"}" does not match expected type "${engineHint}"`,
    );
  }
  if (detectedType && resolvedType && detectedType !== resolvedType) {
    throw new AppStorageError(
      "invalid_binding",
      `Binding "${name || "unknown"}" type mismatch: ${detectedType} vs ${resolvedType}`,
    );
  }
  return {
    type: resolvedType,
    binding: target as R2Bucket | KVNamespace,
    name: name ?? undefined,
  };
}

function detectBindingType(binding: unknown): StorageEngine | null {
  if (!binding || typeof binding !== "object") return null;
  if (typeof (binding as any).head === "function") return "r2";
  if (typeof (binding as any).getWithMetadata === "function") return "kv";
  return null;
}

function pickString(obj: AppBucketDefinition, keys: string[]): string | null {
  for (const key of keys) {
    const value = (obj as any)[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function pickNumber(obj: AppBucketDefinition, keys: string[]): number | null {
  for (const key of keys) {
    const value = (obj as any)[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim()) {
      const num = Number(value);
      if (!Number.isNaN(num)) return num;
    }
  }
  return null;
}

function pickArray(obj: AppBucketDefinition, keys: string[]): unknown[] | null {
  for (const key of keys) {
    const value = (obj as any)[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

function parseEngine(value: string | null): StorageEngine | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "kv" || normalized === "kv_namespace" || normalized === "kv-namespace") {
    return "kv";
  }
  if (normalized === "r2") return "r2";
  return null;
}

function parseMaxSize(maxSizeMb: number | null): number | null {
  if (maxSizeMb === null || maxSizeMb === undefined) return null;
  if (!Number.isFinite(maxSizeMb) || maxSizeMb <= 0) return null;
  return Math.floor(maxSizeMb * 1024 * 1024);
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const noLeading = trimmed.replace(/^\/+/, "");
  return noLeading.endsWith("/") ? noLeading : `${noLeading}/`;
}

function normalizeStringArray(values: unknown[] | null): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
}

function buildKey(basePath: string, key: string, context: StorageTemplateContext): string {
  const expandedBase = applyTemplate(basePath, context);
  const expandedKey = applyTemplate(key, context);
  const cleanedBase = expandedBase.replace(/^\/+/, "").replace(/\/+$/, "");
  const cleanedKey = expandedKey.replace(/^\/+/, "");
  const combined = cleanedBase ? `${cleanedBase}/${cleanedKey}` : cleanedKey;
  if (!combined) {
    throw new AppStorageError("invalid_key", "Storage key must be a non-empty string");
  }
  if (combined.includes("..")) {
    throw new AppStorageError("invalid_key", "Storage key cannot contain '..'");
  }
  return combined;
}

function applyTemplate(template: string, context: StorageTemplateContext): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    const value = context[key];
    if (value === undefined || value === null) {
      throw new AppStorageError("missing_context", `Missing template value for "${key}"`);
    }
    return String(value);
  });
}

function mimeAllowed(contentType: string, allowed: string[]): boolean {
  if (!allowed.length) return true;
  const normalized = contentType.toLowerCase();
  return allowed.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p === "*/*") return true;
    if (p.endsWith("/*")) {
      return normalized.startsWith(p.slice(0, -1));
    }
    return normalized === p;
  });
}

function resolveContentType(value: unknown, options?: AppStoragePutOptions): string | null {
  if (options?.contentType) return options.contentType;
  const httpContent = options?.r2?.httpMetadata && (options.r2.httpMetadata as any).contentType;
  if (typeof httpContent === "string" && httpContent.trim()) {
    return httpContent;
  }
  if (value && typeof value === "object" && typeof (value as any).type === "string") {
    const t = (value as any).type.trim();
    if (t) return t;
  }
  return null;
}

function resolveSize(value: R2PutValue, options?: AppStoragePutOptions): number | null {
  if (typeof options?.size === "number" && options.size >= 0) return options.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value === "string") return new TextEncoder().encode(value).byteLength;
  if (typeof (value as any)?.size === "number") {
    return (value as any).size;
  }
  return null;
}

async function toKvValue(value: R2PutValue): Promise<string | ArrayBuffer | ArrayBufferView | ReadableStream> {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || typeof value === "string") {
    return value as any;
  }
  if (value instanceof ReadableStream) {
    return value;
  }
  if (typeof (value as any)?.arrayBuffer === "function") {
    return (value as any).arrayBuffer();
  }
  return value as any;
}
