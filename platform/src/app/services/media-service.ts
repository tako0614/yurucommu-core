/**
 * Media/Storage Service API
 *
 * R2 + KV によるメディアアップロードとメタデータ管理を提供する。
 * - ファイルアップロード（multipart 対応）
 * - メタデータ管理（App State / KV）
 * - 画像リサイズURL生成（Cloudflare Images / Image Resizing）
 * - ライフサイクル管理（temp → attached → orphaned）
 */

import type { KVNamespace, R2Bucket, R2Object, R2PutOptions } from "@cloudflare/workers-types";
import type { AppAuthContext } from "../runtime/types";
import type { StorageService } from "./storage-service";

export type MediaStatus = "temp" | "attached" | "orphaned" | "deleted";

export type ImageTransformOptions = {
  width?: number;
  height?: number;
  fit?: "cover" | "contain" | "fill" | "inside" | "outside";
  format?: "webp" | "avif" | "jpeg" | "png" | "auto";
  quality?: number;
  blur?: number;
};

export interface MediaObject {
  id: string;
  key?: string;
  bucket?: string;
  url: string;
  created_at?: string;
  updated_at?: string;
  size?: number;
  content_type?: string;
  status?: MediaStatus;
  attached_to?: string | null;
  attached_type?: string | null;
  alt?: string;
  description?: string;
  variants?: Record<string, string>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MediaMetadata extends MediaObject {
  key: string;
  status: MediaStatus;
  user_id?: string | null;
  ref_count?: number;
  expires_at?: string | null;
  orphaned_at?: string | null;
}

export interface UploadMediaInput {
  file: File | Blob | ArrayBuffer | string | FormData;
  filename?: string;
  contentType?: string;
  folder?: string;
  bucket?: string;
  status?: MediaStatus;
  attachedTo?: string | null;
  attachedType?: string | null;
  alt?: string;
  description?: string;
  metadata?: Record<string, string>;
  tempTtlHours?: number;
}

export interface ListMediaParams {
  limit?: number;
  offset?: number;
  status?: MediaStatus | MediaStatus[];
  prefix?: string;
  bucket?: string;
  includeDeleted?: boolean;
}

export interface MediaListResult {
  files: MediaMetadata[];
  next_offset: number | null;
}

export interface MediaService {
  upload(ctx: AppAuthContext, input: UploadMediaInput | FormData): Promise<MediaMetadata>;
  uploadFromFormData(
    ctx: AppAuthContext,
    form: FormData,
    overrides?: Omit<UploadMediaInput, "file">,
  ): Promise<MediaMetadata>;
  get(ctx: AppAuthContext, idOrKey: string): Promise<MediaMetadata | null>;
  listStorage(ctx: AppAuthContext, params?: ListMediaParams): Promise<MediaListResult>;
  deleteStorageObject(ctx: AppAuthContext, key: string): Promise<{ deleted: boolean }>;
  markAttached(
    ctx: AppAuthContext,
    key: string,
    options?: { attachedTo?: string | null; attachedType?: string | null },
  ): Promise<MediaMetadata | null>;
  markOrphaned(ctx: AppAuthContext, key: string): Promise<MediaMetadata | null>;
  getTransformedUrl(
    media: string | MediaObject,
    options?: ImageTransformOptions,
    origin?: string,
  ): string;
  cleanup(
    ctx: AppAuthContext,
    options?: { tempTtlHours?: number; orphanTtlHours?: number },
  ): Promise<{ deleted: string[] }>;
}

export type MediaServiceFactory = (env: unknown, storage?: StorageService) => MediaService;

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_CACHE_CONTROL = "public, max-age=31536000, immutable";
const DEFAULT_TEMP_TTL_HOURS = 24;
const DEFAULT_ORPHAN_TTL_HOURS = 24 * 7;
const encoder = new TextEncoder();

type NormalizedUpload = {
  body: Blob | ArrayBuffer | string;
  filename: string;
  contentType?: string;
  folder?: string;
  bucket?: string;
  status?: MediaStatus;
  attachedTo?: string | null;
  attachedType?: string | null;
  alt?: string;
  description?: string;
  metadata?: Record<string, string>;
  tempTtlHours?: number;
};

const ensureAuth = (ctx: AppAuthContext): string => {
  const userId = (ctx.userId || "").toString().trim();
  if (!userId) throw new Error("Authentication required");
  return userId;
};

const datePrefix = (d = new Date()) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${dd}`;
};

const inferExtFromType = (t: string) => {
  const m = (t || "").toLowerCase();
  if (m.includes("jpeg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("svg")) return "svg";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("webm")) return "webm";
  if (m.includes("quicktime") || m.includes("mov")) return "mov";
  return "";
};

const safeFileExt = (name: string, type?: string): string => {
  const n = (name || "").toLowerCase();
  const dot = n.lastIndexOf(".");
  const extFromName = dot >= 0 ? n.slice(dot + 1).replace(/[^a-z0-9]/g, "") : "";
  const fromType = type ? inferExtFromType(type) : "";
  return (extFromName || fromType || "").slice(0, 8);
};

const randomId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, "");

const sanitizeFolder = (folder?: string | null): string => {
  if (!folder) return "";
  const cleaned = folder.replace(/^\/*/, "").replace(/\/*$/, "").replace(/\.\.+/g, "").trim();
  return cleaned;
};

const resolvePrefix = (userId: string, bucket?: string): string => {
  const base = (bucket || "").trim();
  if (!base || base === "media") return `user-uploads/${userId}`;
  const normalized = base.replace(/^\/+/, "").replace(/\/+$/, "");
  if (normalized.includes("{user}") || normalized.includes("{userId}")) {
    return normalized.replace(/\{user(Id)?\}/gi, userId);
  }
  if (normalized.includes(userId)) return normalized;
  return `${normalized}/${userId}`;
};

const buildStorageKey = (userId: string, upload: NormalizedUpload): string => {
  const prefix = resolvePrefix(userId, upload.bucket);
  const folder = upload.folder ? sanitizeFolder(upload.folder) : datePrefix();
  const ext = safeFileExt(upload.filename, upload.contentType);
  const keyParts = [prefix];
  if (folder) keyParts.push(folder);
  keyParts.push(ext ? `${randomId()}.${ext}` : randomId());
  return keyParts.filter(Boolean).join("/");
};

const resolveContentType = (upload: NormalizedUpload): string => {
  if (upload.contentType) return upload.contentType;
  if (typeof Blob !== "undefined" && upload.body instanceof Blob && upload.body.type) {
    return upload.body.type;
  }
  const ext = safeFileExt(upload.filename, upload.contentType);
  if (ext === "svg") return "image/svg+xml";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  return "application/octet-stream";
};

const getBodySize = (body: unknown): number | undefined => {
  if (typeof body === "string") return encoder.encode(body).length;
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return body.byteLength;
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(body as ArrayBufferView)) {
    return (body as ArrayBufferView).byteLength;
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  return undefined;
};

const normalizeStatus = (status?: MediaStatus | string | null): MediaStatus => {
  const value = (status || "").toString().trim().toLowerCase();
  if (value === "attached") return "attached";
  if (value === "orphaned") return "orphaned";
  if (value === "deleted") return "deleted";
  return "temp";
};

const normalizeStatusFilter = (status?: MediaStatus | MediaStatus[]): Set<MediaStatus> | null => {
  if (!status) return null;
  const values = Array.isArray(status) ? status : [status];
  const set = new Set<MediaStatus>();
  for (const v of values) {
    set.add(normalizeStatus(v));
  }
  return set;
};

const kvPrefix = (userId: string) => `media:${userId}:`;
const kvKey = (userId: string, id: string) => `${kvPrefix(userId)}${id}`;

const parseJson = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const buildPublicBase = (env: any): string | null => {
  const base =
    (typeof env?.MEDIA_PUBLIC_URL === "string" && env.MEDIA_PUBLIC_URL.trim()) ||
    (typeof env?.MEDIA_PUBLIC_BASE === "string" && env.MEDIA_PUBLIC_BASE.trim()) ||
    (typeof env?.MEDIA_CDN === "string" && env.MEDIA_CDN.trim()) ||
    null;
  return base ? base.replace(/\/+$/, "") : null;
};

const buildPublicUrl = (key: string, env: any, storage?: StorageService): string => {
  if (storage?.getPublicUrl) {
    return storage.getPublicUrl(key);
  }
  const base = buildPublicBase(env);
  const encodedKey = key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return base ? `${base}/${encodedKey}` : `/media/${encodedKey}`;
};

const buildTransformParams = (options?: ImageTransformOptions): string | null => {
  if (!options) return null;
  const params: string[] = [];
  if (options.width && options.width > 0) params.push(`width=${Math.round(options.width)}`);
  if (options.height && options.height > 0) params.push(`height=${Math.round(options.height)}`);
  if (options.fit) params.push(`fit=${options.fit}`);
  if (options.format) params.push(`format=${options.format}`);
  if (options.quality && options.quality > 0) params.push(`quality=${Math.max(1, Math.min(100, Math.round(options.quality)))}`);
  if (options.blur && options.blur > 0) params.push(`blur=${Math.round(options.blur)}`);
  return params.length ? params.join(",") : null;
};

const buildTransformUrl = (baseUrl: string, options?: ImageTransformOptions, origin?: string): string => {
  const params = buildTransformParams(options);
  if (!params) return baseUrl;
  const hasProtocol = /^https?:\/\//i.test(baseUrl);
  if (hasProtocol) {
    const url = new URL(baseUrl);
    const path = `${url.pathname}${url.search || ""}`;
    return `${url.origin}/cdn-cgi/image/${params}${path}`;
  }
  const normalizedOrigin = origin ? origin.replace(/\/+$/, "") : "";
  const prefix = baseUrl.startsWith("/") ? baseUrl : `/${baseUrl}`;
  return `${normalizedOrigin}/cdn-cgi/image/${params}${prefix}`;
};

const resolveBucket = (env: any): R2Bucket => {
  if (!env?.MEDIA) throw new Error("media storage not configured");
  return env.MEDIA as R2Bucket;
};

const resolveKv = (env: any): KVNamespace | null => (env?.KV ? (env.KV as KVNamespace) : null);

const parseFormString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }
  return undefined;
};

const parseStatusValue = (value: unknown): MediaStatus | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "temp" || normalized === "attached" || normalized === "orphaned" || normalized === "deleted") {
    return normalized as MediaStatus;
  }
  return undefined;
};

const extractFromFormData = (form: FormData): NormalizedUpload => {
  const fileEntry = form.get("file") as any;
  if (!(typeof Blob !== "undefined" && fileEntry instanceof Blob)) {
    throw new Error("file is required");
  }
  const filename =
    parseFormString(form.get("filename")) ||
    parseFormString(form.get("name")) ||
    ((fileEntry as any).name as string | undefined) ||
    "upload";
  const folder = parseFormString(form.get("folder") ?? form.get("path"));
  const status = parseStatusValue(form.get("status"));
  const attachedTo = parseFormString(form.get("attached_to") ?? form.get("attachedTo"));
  const attachedType = parseFormString(form.get("attached_type") ?? form.get("attachedType"));
  const alt = parseFormString(form.get("alt") ?? form.get("description"));
  const description = parseFormString(form.get("description"));
  const bucket = parseFormString(form.get("bucket"));
  const contentType = parseFormString(form.get("content_type")) || (fileEntry as any).type;
  return {
    body: fileEntry,
    filename,
    folder: folder || undefined,
    status: status || undefined,
    attachedTo: attachedTo || null,
    attachedType: attachedType || null,
    alt: alt || undefined,
    description: description || undefined,
    bucket: bucket || undefined,
    contentType: contentType || undefined,
  };
};

const isFormData = (value: unknown): value is FormData =>
  typeof FormData !== "undefined" && value instanceof FormData;

const normalizeUploadInput = (input: UploadMediaInput | FormData): NormalizedUpload => {
  if (isFormData(input)) {
    return extractFromFormData(input);
  }
  const base = input as UploadMediaInput;
  if (isFormData(base.file)) {
    const fromForm = extractFromFormData(base.file as FormData);
    return {
      ...fromForm,
      status: base.status ?? fromForm.status,
      attachedTo: base.attachedTo ?? fromForm.attachedTo,
      attachedType: base.attachedType ?? fromForm.attachedType,
      alt: base.alt ?? fromForm.alt,
      description: base.description ?? fromForm.description,
      metadata: base.metadata ?? fromForm.metadata,
      tempTtlHours: base.tempTtlHours ?? fromForm.tempTtlHours,
      folder: base.folder ?? fromForm.folder,
      bucket: base.bucket ?? fromForm.bucket,
    };
  }
  if (!base.file) {
    throw new Error("file is required");
  }
  const filename =
    base.filename ||
    (typeof Blob !== "undefined" && base.file instanceof Blob && (base.file as any).name) ||
    "upload";
  const contentType =
    base.contentType ||
    (typeof Blob !== "undefined" && base.file instanceof Blob && (base.file as Blob).type ? (base.file as Blob).type : undefined);
  return {
    body: base.file as any,
    filename,
    contentType: contentType || undefined,
    folder: base.folder,
    bucket: base.bucket,
    status: base.status,
    attachedTo: base.attachedTo ?? null,
    attachedType: base.attachedType ?? null,
    alt: base.alt,
    description: base.description,
    metadata: base.metadata,
    tempTtlHours: base.tempTtlHours,
  };
};

const toMediaMetadata = (
  env: any,
  upload: NormalizedUpload,
  key: string,
  userId: string,
  size: number | undefined,
  status: MediaStatus,
  storage?: StorageService,
): MediaMetadata => {
  const now = new Date().toISOString();
  const meta: MediaMetadata = {
    id: key,
    key,
    bucket: upload.bucket ?? "media",
    url: buildPublicUrl(key, env, storage),
    created_at: now,
    updated_at: now,
    size,
    content_type: resolveContentType(upload),
    status,
    user_id: userId,
    attached_to: upload.attachedTo ?? null,
    attached_type: upload.attachedType ?? null,
    alt: upload.alt,
    description: upload.description,
    ref_count: status === "attached" ? 1 : 0,
    metadata: upload.metadata,
  };
  if (status === "temp") {
    const ttl = upload.tempTtlHours ?? DEFAULT_TEMP_TTL_HOURS;
    meta.expires_at = new Date(Date.now() + ttl * 3600 * 1000).toISOString();
  }
  if (status === "orphaned") {
    meta.orphaned_at = now;
  }
  return meta;
};

const fromR2Object = (env: any, obj: R2Object, storage?: StorageService): MediaMetadata => {
  const custom = (obj as any).customMetadata as Record<string, string> | undefined;
  const status = normalizeStatus(custom?.status ?? "attached");
  return {
    id: obj.key,
    key: obj.key,
    bucket: "media",
    url: buildPublicUrl(obj.key, env, storage),
    created_at: obj.uploaded ? new Date(obj.uploaded).toISOString() : undefined,
    updated_at: obj.uploaded ? new Date(obj.uploaded).toISOString() : undefined,
    size: obj.size,
    content_type: obj.httpMetadata?.contentType,
    status,
    user_id: custom?.user_id ?? undefined,
    attached_to: custom?.attached_to ?? null,
    attached_type: custom?.attached_type ?? null,
    alt: custom?.alt,
    description: custom?.description,
    metadata: custom,
  };
};

export const createMediaService: MediaServiceFactory = (env: any, storage?: StorageService): MediaService => {
  const kv = resolveKv(env);

  const readMetadata = async (userId: string, id: string): Promise<MediaMetadata | null> => {
    if (!kv) return null;
    const raw = await kv.get(kvKey(userId, id));
    const parsed = parseJson<MediaMetadata>(raw);
    if (!parsed) return null;
    return {
      ...parsed,
      key: parsed.key || parsed.id,
      id: parsed.id || parsed.key,
      url: parsed.url || buildPublicUrl(parsed.key || parsed.id, env, storage),
    };
  };

  const writeMetadata = async (userId: string, meta: MediaMetadata) => {
    if (!kv) return;
    await kv.put(kvKey(userId, meta.id), JSON.stringify(meta));
  };

  const deleteMetadata = async (userId: string, id: string) => {
    if (!kv) return;
    await kv.delete(kvKey(userId, id));
  };

  const withTransformedUrl = (meta: MediaMetadata): MediaMetadata => {
    if (!meta.url) {
      return { ...meta, url: buildPublicUrl(meta.key, env, storage) };
    }
    return meta;
  };

  const upload = async (ctx: AppAuthContext, input: UploadMediaInput | FormData): Promise<MediaMetadata> => {
    const userId = ensureAuth(ctx);
    const uploadInput = normalizeUploadInput(input);
    const bucket = resolveBucket(env);
    const key = buildStorageKey(userId, uploadInput);
    const contentType = resolveContentType(uploadInput);
    const size = getBodySize(uploadInput.body);
    const status = normalizeStatus(uploadInput.status ?? (uploadInput.attachedTo ? "attached" : "temp"));
    const customMetadata: Record<string, string> = {
      user_id: userId,
      status,
      attached_to: uploadInput.attachedTo ?? "",
      attached_type: uploadInput.attachedType ?? "",
    };
    if (uploadInput.alt) customMetadata.alt = uploadInput.alt;
    if (uploadInput.description) customMetadata.description = uploadInput.description;
    const options: R2PutOptions = {
      httpMetadata: { contentType, cacheControl: DEFAULT_CACHE_CONTROL },
      customMetadata,
    };
    await bucket.put(key, uploadInput.body as any, options);
    const meta = toMediaMetadata(env, uploadInput, key, userId, size, status, storage);
    await writeMetadata(userId, meta);
    return withTransformedUrl(meta);
  };

  return {
    upload,

    async uploadFromFormData(ctx, form, overrides) {
      const merged = extractFromFormData(form);
      const input: UploadMediaInput = {
        ...overrides,
        file: form,
        filename: overrides?.filename ?? merged.filename,
        folder: overrides?.folder ?? merged.folder,
        bucket: overrides?.bucket ?? merged.bucket,
        status: overrides?.status ?? merged.status,
        attachedTo: overrides?.attachedTo ?? merged.attachedTo,
        attachedType: overrides?.attachedType ?? merged.attachedType,
        alt: overrides?.alt ?? merged.alt,
        description: overrides?.description ?? merged.description,
        contentType: overrides?.contentType ?? merged.contentType,
        metadata: overrides?.metadata ?? merged.metadata,
        tempTtlHours: overrides?.tempTtlHours ?? merged.tempTtlHours,
      };
      return upload(ctx, input);
    },

    async get(ctx, idOrKey) {
      const userId = ensureAuth(ctx);
      const cached = await readMetadata(userId, idOrKey);
      if (cached) return withTransformedUrl(cached);
      try {
        const bucket = resolveBucket(env);
        const obj = (await bucket.head?.(idOrKey)) as R2Object | null;
        if (obj) return withTransformedUrl(fromR2Object(env, obj, storage));
      } catch {
        // ignore head failures
      }
      return null;
    },

    async listStorage(ctx, params) {
      const userId = ensureAuth(ctx);
      const limit = Math.min(200, Math.max(1, params?.limit ?? DEFAULT_PAGE_SIZE));
      const offset = Math.max(0, params?.offset ?? 0);
    const statusFilter = normalizeStatusFilter(params?.status);
    if (kv) {
      const list = await kv.list({ prefix: kvPrefix(userId) });
      const metas: MediaMetadata[] = [];
      for (const key of list.keys) {
          const raw = await kv.get(key.name);
          const parsed = parseJson<MediaMetadata>(raw);
          if (!parsed) continue;
          if (!params?.includeDeleted && parsed.status === "deleted") continue;
          if (statusFilter && (!parsed.status || !statusFilter.has(parsed.status))) continue;
          if (params?.prefix && parsed.key && !parsed.key.startsWith(params.prefix)) continue;
          metas.push(withTransformedUrl(parsed));
        }
        metas.sort((a, b) => {
          const at = a.created_at || a.updated_at || "";
          const bt = b.created_at || b.updated_at || "";
          return bt.localeCompare(at);
        });
        const files = metas.slice(offset, offset + limit);
        const next_offset = offset + limit < metas.length ? offset + limit : null;
        return { files, next_offset };
      }

      const bucket = resolveBucket(env);
      const defaultPrefix = resolvePrefix(userId, params?.bucket);
      const prefix = params?.prefix || defaultPrefix;
      if (!prefix.startsWith(defaultPrefix)) {
        throw new Error("forbidden");
      }
      const r2List = await bucket.list({ prefix, limit: offset + limit + 1 });
      const mapped = r2List.objects.map((obj) => fromR2Object(env, obj, storage));
      const files = mapped.slice(offset, offset + limit);
      const hasMore = r2List.truncated || mapped.length > offset + limit;
      const next_offset = hasMore ? offset + files.length : null;
      return { files, next_offset };
    },

    async deleteStorageObject(ctx, key) {
      const userId = ensureAuth(ctx);
      const bucket = resolveBucket(env);
      const meta = await readMetadata(userId, key);
      if (meta?.user_id && meta.user_id !== userId) {
        throw new Error("forbidden");
      }
      if (!meta) {
        const expectedPrefix = resolvePrefix(userId);
        if (!key.startsWith(expectedPrefix)) {
          throw new Error("forbidden");
        }
      }
      await bucket.delete(key);
      await deleteMetadata(userId, key);
      return { deleted: true };
    },

    async markAttached(ctx, key, options) {
      const userId = ensureAuth(ctx);
      if (!kv) return null;
      const meta = (await readMetadata(userId, key)) ?? {
        id: key,
        key,
        status: "attached" as MediaStatus,
        url: buildPublicUrl(key, env, storage),
      };
      if (meta.user_id && meta.user_id !== userId) throw new Error("forbidden");
      const now = new Date().toISOString();
      const updated: MediaMetadata = {
        ...meta,
        status: "attached",
        attached_to: options?.attachedTo ?? meta.attached_to ?? null,
        attached_type: options?.attachedType ?? meta.attached_type ?? null,
        ref_count: (meta.ref_count ?? 0) + 1,
        orphaned_at: null,
        updated_at: now,
      };
      await writeMetadata(userId, updated);
      return withTransformedUrl(updated);
    },

    async markOrphaned(ctx, key) {
      const userId = ensureAuth(ctx);
      if (!kv) return null;
      const meta = await readMetadata(userId, key);
      if (!meta) return null;
      if (meta.user_id && meta.user_id !== userId) throw new Error("forbidden");
      const now = new Date().toISOString();
      const updated: MediaMetadata = {
        ...meta,
        status: "orphaned",
        ref_count: Math.max(0, (meta.ref_count ?? 0) - 1),
        orphaned_at: now,
        updated_at: now,
      };
      await writeMetadata(userId, updated);
      return withTransformedUrl(updated);
    },

    getTransformedUrl(media, options, origin) {
      const baseUrl = typeof media === "string" ? buildPublicUrl(media, env, storage) : media.url;
      return buildTransformUrl(baseUrl, options, origin);
    },

    async cleanup(ctx, options) {
      const userId = ensureAuth(ctx);
      if (!kv) return { deleted: [] };
      const bucket = resolveBucket(env);
      const list = await kv.list({ prefix: kvPrefix(userId) });
      const deleted: string[] = [];
      const now = Date.now();
      const tempTtlMs = (options?.tempTtlHours ?? DEFAULT_TEMP_TTL_HOURS) * 3600 * 1000;
      const orphanTtlMs = (options?.orphanTtlHours ?? DEFAULT_ORPHAN_TTL_HOURS) * 3600 * 1000;
      for (const key of list.keys) {
        const meta = parseJson<MediaMetadata>(await kv.get(key.name));
        if (!meta) continue;
        if (meta.status === "temp") {
          const created = meta.created_at ? Date.parse(meta.created_at) : null;
          if (created !== null && now - created > tempTtlMs) {
            await bucket.delete(meta.key || meta.id);
            await kv.delete(key.name);
            deleted.push(meta.key || meta.id);
          }
        }
        if (meta.status === "orphaned") {
          const orphaned = meta.orphaned_at ? Date.parse(meta.orphaned_at) : null;
          if (orphaned !== null && now - orphaned > orphanTtlMs) {
            await bucket.delete(meta.key || meta.id);
            await kv.delete(key.name);
            deleted.push(meta.key || meta.id);
          }
        }
      }
      return { deleted };
    },
  };
};
