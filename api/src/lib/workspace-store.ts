/// <reference types="@cloudflare/workers-types" />

import type { DevDataIsolationResult, PublicAccountBindings } from "@takos/platform/server";
import { releaseStore, resolveDevDataIsolation } from "@takos/platform/server";
import { parseUiContractJson, type AppManifestValidationIssue, type UiContract } from "@takos/platform/app";
import { makeData } from "../data";
import type { AppWorkspaceManifest, PreviewMode } from "./app-preview";

export type WorkspaceAuthorType = "human" | "agent";
export type AppWorkspaceStatus = "draft" | "validated" | "testing" | "ready" | "applied";

export type AppWorkspaceRecord = {
  id: string;
  base_revision_id: string | null;
  status: AppWorkspaceStatus;
  author_type: WorkspaceAuthorType;
  author_name: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkspaceFileRecord = {
  workspace_id: string;
  path: string;
  content: Uint8Array;
  content_type: string | null;
  size?: number;
  content_hash?: string | null;
  storage_key?: string | null;
  directory_path?: string | null;
  is_cache?: boolean;
  created_at: string;
  updated_at: string;
};

export type WorkspaceFileContent = string | ArrayBuffer | ArrayBufferView | Uint8Array;

export type WorkspaceFileStat = Omit<WorkspaceFileRecord, "content">;

export type WorkspaceUsage = {
  fileCount: number;
  totalSize: number;
};

export type WorkspaceSnapshotRecord = {
  id: string;
  workspace_id: string;
  status: string;
  storage_key: string;
  size_bytes?: number | null;
  file_count?: number | null;
  created_at: string;
};

export type VfsDirectoryRecord = {
  workspace_id: string;
  path: string;
  name: string;
  parent_path: string | null;
  created_at: string;
  updated_at: string;
};

export type AppWorkspaceUpsert = {
  id: string;
  base_revision_id?: string | null;
  status?: AppWorkspaceStatus;
  author_type: WorkspaceAuthorType;
  author_name?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
};

export type WorkspaceStore = {
  getWorkspace(id: string): Promise<AppWorkspaceRecord | null>;
  listWorkspaces(limit?: number): Promise<AppWorkspaceRecord[]>;
  upsertWorkspace(workspace: AppWorkspaceUpsert): Promise<AppWorkspaceRecord | null>;
  updateWorkspaceStatus(
    id: string,
    status: AppWorkspaceStatus,
  ): Promise<AppWorkspaceRecord | null>;
  saveWorkspaceFile(
    workspaceId: string,
    path: string,
    content: WorkspaceFileContent,
    contentType?: string | null,
    options?: { cacheControl?: string | null },
  ): Promise<WorkspaceFileRecord | null>;
  getWorkspaceFile(workspaceId: string, path: string): Promise<WorkspaceFileRecord | null>;
  listWorkspaceFiles(workspaceId: string, prefix?: string): Promise<WorkspaceFileRecord[]>;
  deleteWorkspaceFile?(workspaceId: string, path: string): Promise<boolean>;
  statWorkspaceFile?(workspaceId: string, path: string): Promise<WorkspaceFileStat | null>;
  getWorkspaceUsage?(workspaceId: string): Promise<WorkspaceUsage>;
  listDirectories?(workspaceId: string, path?: string): Promise<VfsDirectoryRecord[]>;
  ensureDirectory?(workspaceId: string, path: string): Promise<VfsDirectoryRecord | null>;
  deleteWorkspace?(workspaceId: string): Promise<boolean>;
  saveWorkspaceSnapshot?(
    workspaceId: string,
    status: AppWorkspaceStatus,
  ): Promise<WorkspaceSnapshotRecord | null>;
  saveCompileCache?(
    workspaceId: string,
    hash: string,
    content: WorkspaceFileContent,
    options?: { contentType?: string | null; cacheControl?: string | null },
  ): Promise<WorkspaceFileRecord | null>;
  getCompileCache?(workspaceId: string, hash: string): Promise<WorkspaceFileRecord | null>;
  copyWorkspaceFile?(workspaceId: string, from: string, to: string): Promise<WorkspaceFileRecord | null>;
  moveWorkspaceFile?(workspaceId: string, from: string, to: string): Promise<WorkspaceFileRecord | null>;
  deleteDirectory?(
    workspaceId: string,
    path: string,
    options?: { recursive?: boolean },
  ): Promise<{ deletedFiles: number; deletedDirectories: number }>;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const defaultWorkspaceIds = new Set(["default", "demo", "ws_demo"]);
const demoWorkspace: AppWorkspaceManifest = {
  id: "ws_demo",
  name: "Demo Workspace",
  views: {
    screens: [
      {
        id: "screen.home",
        route: "/",
        title: "Home",
        layout: {
          type: "Column",
          props: { id: "root", gap: 12 },
          children: [
            {
              type: "Row",
              props: { id: "header", slot: "header", gap: 8, align: "center" },
              children: [
                { type: "Text", props: { text: "Home", variant: "title" } },
                { type: "Spacer", props: { flex: 1 } },
              ],
            },
            {
              type: "Row",
              props: { id: "content", gap: 12 },
              children: [
                {
                  type: "Column",
                  props: { id: "main", slot: "main", flex: 2 },
                  children: [{ type: "Placeholder", props: { text: "Timeline" } }],
                },
                {
                  type: "Column",
                  props: { id: "right-sidebar", slot: "right-sidebar", flex: 1, gap: 8 },
                  children: [{ type: "Placeholder", props: { text: "Sidebar" } }],
                },
              ],
            },
          ],
        },
      },
    ],
    insert: [
      {
        screen: "screen.home",
        position: "right-sidebar",
        order: 10,
        node: {
          type: "Card",
          props: { title: "Notes" },
          children: [
            {
              type: "Text",
              props: { text: "Workspace inserts render into layout slots." },
            },
          ],
        },
      },
      {
        screen: "screen.home",
        position: "header",
        order: 5,
        node: {
          type: "Button",
          props: {
            action: "action.open_composer",
            label: "Compose",
            emphasis: "primary",
          },
        },
      },
    ],
  },
};
export const DEFAULT_MANIFEST_PATH = "app/manifest.json";
export const DEFAULT_UI_CONTRACT_PATH = "schemas/ui-contract.json";

type WorkspaceEnv = Partial<PublicAccountBindings> & {
  DB?: D1Database;
  VFS_BUCKET?: R2Bucket;
  WORKSPACE_VFS?: R2Bucket;
  workspaceStore?: WorkspaceStore;
};

export type LoadWorkspaceOptions = {
  mode: PreviewMode;
  env?: WorkspaceEnv | null;
  store?: WorkspaceStore | null;
};

export type WorkspaceResolution = {
  env: WorkspaceEnv;
  store: WorkspaceStore | null;
  isolation: DevDataIsolationResult | null;
};

const resolveWorkspaceBucket = (
  env: WorkspaceEnv,
  isolation: DevDataIsolationResult | null,
): R2Bucket | null => {
  const fromEnv =
    (env as any).WORKSPACE_VFS ||
    (env as any).VFS_BUCKET ||
    (env as any).VFS ||
    (env as any).MEDIA ||
    null;
  if (fromEnv) return fromEnv as R2Bucket;
  if (isolation?.resolved?.media) return isolation.resolved.media as R2Bucket;
  return null;
};

const normalizeStatus = (status?: string): AppWorkspaceStatus => {
  switch ((status || "").trim()) {
    case "validated":
      return "validated";
    case "testing":
      return "testing";
    case "ready":
      return "ready";
    case "applied":
      return "applied";
    default:
      return "draft";
  }
};

const normalizeAuthorType = (type?: string): WorkspaceAuthorType =>
  type === "agent" ? "agent" : "human";

const toTimestamp = (value?: string | Date | null): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const normalizePath = (path: string): string => {
  const cleaned = (path || "").replace(/\\/g, "/").trim();
  const stripped = cleaned.replace(/^\/+/, "").replace(/\/+/g, "/");
  const normalized = stripped.endsWith("/") ? stripped.slice(0, -1) : stripped;
  if (normalized.includes("..")) {
    throw new Error("invalid workspace path");
  }
  return normalized;
};

const normalizeDirectoryPath = (path: string): string => {
  const normalized = normalizePath(path);
  return normalized || "/";
};

const parentDirectory = (path: string): string => {
  const normalized = normalizePath(path);
  if (!normalized) return "/";
  const idx = normalized.lastIndexOf("/");
  return idx <= 0 ? "/" : normalized.slice(0, idx);
};

const escapeLikePattern = (value: string): string => value.replace(/([%_\\])/g, "\\$1");

const globToRegExp = (pattern: string): RegExp => {
  const normalized = pattern.replace(/\\/g, "/");
  let source = "^";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    const next = normalized[i + 1];
    if (ch === "*" && next === "*") {
      source += ".*";
      i += 1;
      continue;
    }
    if (ch === "*") {
      source += "[^/]*";
      continue;
    }
    if (ch === "?") {
      source += "[^/]";
      continue;
    }
    if ("+.^$|()[]{}".includes(ch)) {
      source += `\\${ch}`;
      continue;
    }
    source += ch;
  }
  source += "$";
  return new RegExp(source);
};

const toBytes = (input: WorkspaceFileContent): Uint8Array => {
  if (typeof input === "string") {
    return encoder.encode(input);
  }
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    const view = input as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  throw new Error("unsupported workspace file content type");
};

const mapWorkspaceRow = (row: any): AppWorkspaceRecord | null => {
  if (!row) return null;
  return {
    id: String(row.id),
    base_revision_id: row.base_revision_id ?? null,
    status: normalizeStatus(row.status),
    author_type: normalizeAuthorType(row.author_type),
    author_name: row.author_name ?? null,
    created_at: row.created_at ? String(row.created_at) : "",
    updated_at: row.updated_at ? String(row.updated_at) : "",
  };
};

const isArrayBufferLike = (value: unknown): value is ArrayBuffer =>
  value instanceof ArrayBuffer ||
  (!!value && typeof value === "object" && typeof (value as ArrayBuffer).byteLength === "number");

const mapWorkspaceFileRow = (row: any): WorkspaceFileRecord | null => {
  if (!row) return null;
  let content: Uint8Array;
  if (row.content instanceof Uint8Array) {
    content = row.content;
  } else if (isArrayBufferLike(row.content)) {
    content = new Uint8Array(row.content);
  } else {
    content = new Uint8Array();
  }
  const path = String(row.path ?? "");
  const directoryPath = row.directory_path ?? parentDirectory(path);
  const size =
    typeof row.size === "number" && Number.isFinite(row.size) && row.size >= 0
      ? Number(row.size)
      : content.byteLength;
  return {
    workspace_id: String(row.workspace_id),
    path,
    directory_path: directoryPath,
    content,
    size,
    content_hash: row.content_hash ?? null,
    storage_key: row.storage_key ?? null,
    is_cache: row.is_cache === 1 || row.is_cache === true,
    content_type: row.content_type ?? null,
    created_at: row.created_at ? String(row.created_at) : "",
    updated_at: row.updated_at ? String(row.updated_at) : "",
  };
};

const parseManifestJson = (text: string, workspaceId?: string): AppWorkspaceManifest | null => {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const views = (parsed as any).views;
    if (!views || typeof views !== "object") {
      return null;
    }
    const id =
      typeof (parsed as any).id === "string" && (parsed as any).id.trim().length > 0
        ? (parsed as any).id.trim()
        : workspaceId;
    const name =
      typeof (parsed as any).name === "string" && (parsed as any).name.trim().length > 0
        ? (parsed as any).name.trim()
        : undefined;
    return { id, name, views };
  } catch (error) {
    console.warn("[workspace] failed to parse manifest json", error);
    return null;
  }
};

const parseWorkspaceFileManifest = (
  file: WorkspaceFileRecord | null,
  workspaceId?: string,
): AppWorkspaceManifest | null => {
  if (!file) return null;
  const text = decoder.decode(file.content);
  return parseManifestJson(text, workspaceId);
};

const runStatement = async (db: D1Database, sql: string, params: any[] = [], expectRows = false) => {
  let stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt = stmt.bind(...params);
  }
  const lowered = sql.trim().toLowerCase();
  const shouldFetch =
    expectRows ||
    lowered.startsWith("select") ||
    lowered.startsWith("pragma") ||
    lowered.startsWith("with");
  if (shouldFetch) {
    const res = await stmt.all();
    return res.results ?? [];
  }
  await stmt.run();
  return [];
};

const emptyBytes = new Uint8Array();

const safeDirName = (path: string): string => {
  const normalized = normalizeDirectoryPath(path);
  if (normalized === "/") return "/";
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "/";
};

const encodeKeySegment = (value: string): string =>
  encodeURIComponent(value).replace(/%2F/gi, "/");

const buildVfsStorageKey = (workspaceId: string, path: string): string => {
  const safeWorkspace = encodeKeySegment(workspaceId);
  const normalized = normalizePath(path);
  const safePath = normalized
    ? normalized
        .split("/")
        .map((segment) => encodeKeySegment(segment || "root"))
        .join("/")
    : "root";
  return `vfs/${safeWorkspace}/${safePath}`;
};

const buildSnapshotKey = (workspaceId: string, status: AppWorkspaceStatus): string => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `vfs-snapshots/${encodeKeySegment(workspaceId)}/${status}/${timestamp}.json`;
};

const buildCompileCacheKey = (workspaceId: string, hash: string): string => {
  const normalizedHash = hash.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 128) || "default";
  return `vfs-cache/esbuild/${encodeKeySegment(workspaceId)}/${normalizedHash}`;
};

const computeSha256 = async (data: Uint8Array): Promise<string> => {
  try {
    if (typeof crypto?.subtle?.digest === "function") {
      const digest = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    // fall through to node:crypto
  }
  try {
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(Buffer.from(data)).digest("hex");
  } catch {
    return "";
  }
};

const toBase64 = (bytes: Uint8Array): string => {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const readR2Object = async (bucket: R2Bucket | null, key: string | null | undefined) => {
  if (!bucket || !key) return null;
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    const buffer = await obj.arrayBuffer();
    return new Uint8Array(buffer);
  } catch (error) {
    console.warn("[workspace] failed to read R2 object", error);
    return null;
  }
};

const writeR2Object = async (
  bucket: R2Bucket | null,
  key: string,
  body: Uint8Array,
  contentType?: string | null,
  cacheControl?: string | null,
) => {
  if (!bucket) return false;
  try {
    await bucket.put(key, body, {
      httpMetadata: {
        contentType: contentType || "application/octet-stream",
        cacheControl: cacheControl ?? undefined,
      },
    });
    return true;
  } catch (error) {
    console.warn("[workspace] failed to write R2 object", error);
    return false;
  }
};

const deleteR2Object = async (bucket: R2Bucket | null, key: string | null | undefined) => {
  if (!bucket || !key) return;
  try {
    await bucket.delete(key);
  } catch (error) {
    console.warn("[workspace] failed to delete R2 object", error);
  }
};

export function createWorkspaceStore(db: D1Database, bucket?: R2Bucket | null): WorkspaceStore {
  if (!db) throw new Error("D1 database binding (DB) is required for workspace store");
  const vfsBucket = bucket ?? null;

  const getWorkspace = async (id: string) => {
    const rows = await runStatement(
      db,
      `SELECT id, base_revision_id, status, author_type, author_name, created_at, updated_at
       FROM app_workspaces
       WHERE id = ?
       LIMIT 1`,
      [id],
      true,
    );
    return mapWorkspaceRow(rows[0]);
  };

  const listWorkspaces = async (limit: number = 20) => {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const rows = await runStatement(
      db,
      `SELECT id, base_revision_id, status, author_type, author_name, created_at, updated_at
       FROM app_workspaces
       ORDER BY created_at DESC
       LIMIT ?`,
      [safeLimit],
      true,
    );
    return rows.map(mapWorkspaceRow).filter(Boolean) as AppWorkspaceRecord[];
  };

  const upsertWorkspace = async (workspace: AppWorkspaceUpsert) => {
    const id = workspace.id?.trim();
    if (!id) throw new Error("workspace id is required");
    const status = normalizeStatus(workspace.status);
    const createdAt = toTimestamp(workspace.created_at);
    const updatedAt = toTimestamp(workspace.updated_at) || new Date().toISOString();

    await runStatement(
      db,
      `INSERT INTO app_workspaces (id, base_revision_id, status, author_type, author_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
       ON CONFLICT(id) DO UPDATE SET
         base_revision_id = excluded.base_revision_id,
         status = excluded.status,
         author_type = excluded.author_type,
         author_name = excluded.author_name,
         updated_at = excluded.updated_at`,
      [
        id,
        workspace.base_revision_id ?? null,
        status,
        normalizeAuthorType(workspace.author_type),
        workspace.author_name ?? null,
        createdAt,
        updatedAt,
      ],
    );
    return getWorkspace(id);
  };

  const updateWorkspaceStatus = async (id: string, status: AppWorkspaceStatus) => {
    await runStatement(
      db,
      `UPDATE app_workspaces
       SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [normalizeStatus(status), id],
    );
    return getWorkspace(id);
  };

  const ensureDirectoryChain = async (workspaceId: string, dirPath: string) => {
    const normalizedDir = normalizeDirectoryPath(dirPath);
    // always ensure root
    await runStatement(
      db,
      `INSERT INTO vfs_directories (workspace_id, path, name, parent_path, created_at, updated_at)
       VALUES (?, '/', '/', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(workspace_id, path) DO UPDATE SET updated_at = excluded.updated_at`,
      [workspaceId],
    );

    if (normalizedDir === "/") return;
    const segments = normalizedDir.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const parent = parentDirectory(current);
      await runStatement(
        db,
        `INSERT INTO vfs_directories (workspace_id, path, name, parent_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(workspace_id, path) DO UPDATE SET updated_at = excluded.updated_at`,
        [workspaceId, current, safeDirName(current), parent === "" ? "/" : parent],
      );
    }
  };

  const getVfsMeta = async (workspaceId: string, path: string) => {
    const rows = await runStatement(
      db,
      `SELECT workspace_id, path, directory_path, content_type, content_hash, size, storage_key, is_cache, created_at, updated_at
       FROM vfs_files
       WHERE workspace_id = ? AND path = ?
       LIMIT 1`,
      [workspaceId, normalizePath(path)],
      true,
    );
    return rows[0];
  };

  const listVfsMeta = async (workspaceId: string, prefix?: string) => {
    const hasPrefix = typeof prefix === "string" && prefix.trim().length > 0;
    const likePattern = hasPrefix ? `${escapeLikePattern(normalizePath(prefix))}%` : null;
    const params = hasPrefix ? [workspaceId, likePattern] : [workspaceId];
    const rows = await runStatement(
      db,
      `SELECT workspace_id, path, directory_path, content_type, content_hash, size, storage_key, is_cache, created_at, updated_at
       FROM vfs_files
       WHERE workspace_id = ? ${hasPrefix ? "AND path LIKE ? ESCAPE '\\'" : ""}
       ORDER BY path`,
      params,
      true,
    );
    return rows || [];
  };

  const upsertVfsMeta = async (
    workspaceId: string,
    path: string,
    directoryPath: string,
    contentType: string | null,
    size: number,
    contentHash: string,
    storageKey: string,
    isCache: boolean,
  ) => {
    await runStatement(
      db,
      `INSERT INTO vfs_files (workspace_id, path, directory_path, content_type, content_hash, size, storage_key, is_cache, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(workspace_id, path) DO UPDATE SET
         directory_path = excluded.directory_path,
         content_type = excluded.content_type,
         content_hash = excluded.content_hash,
         size = excluded.size,
         storage_key = excluded.storage_key,
         is_cache = excluded.is_cache,
         updated_at = excluded.updated_at`,
      [
        workspaceId,
        normalizePath(path),
        normalizeDirectoryPath(directoryPath),
        contentType ?? null,
        contentHash || null,
        size,
        storageKey,
        isCache ? 1 : 0,
      ],
    );
  };

  const fetchLegacyFile = async (workspaceId: string, path: string) => {
    const rows = await runStatement(
      db,
      `SELECT workspace_id, path, content, content_type, created_at, updated_at
       FROM app_workspace_files
       WHERE workspace_id = ? AND path = ?
       LIMIT 1`,
      [workspaceId, normalizePath(path)],
      true,
    );
    return mapWorkspaceFileRow(rows[0]);
  };

  const listLegacyFiles = async (workspaceId: string, prefix?: string) => {
    const hasPrefix = typeof prefix === "string" && prefix.trim().length > 0;
    const likePattern = hasPrefix ? `${escapeLikePattern(normalizePath(prefix))}%` : null;
    const params = hasPrefix ? [workspaceId, likePattern] : [workspaceId];
    const rows = await runStatement(
      db,
      `SELECT workspace_id, path, content, content_type, created_at, updated_at
       FROM app_workspace_files
       WHERE workspace_id = ? ${hasPrefix ? "AND path LIKE ? ESCAPE '\\'" : ""}
       ORDER BY path`,
      params,
      true,
    );
    return rows.map(mapWorkspaceFileRow).filter(Boolean) as WorkspaceFileRecord[];
  };

  const upsertLegacyFile = async (
    workspaceId: string,
    path: string,
    content: Uint8Array,
    contentType: string | null,
  ) => {
    await runStatement(
      db,
      `INSERT INTO app_workspace_files (workspace_id, path, content, content_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(workspace_id, path) DO UPDATE SET
         content = excluded.content,
         content_type = excluded.content_type,
         updated_at = excluded.updated_at`,
      [workspaceId, normalizePath(path), content, contentType ?? null],
    );
  };

  const deleteLegacyFile = async (workspaceId: string, path: string) => {
    await runStatement(
      db,
      `DELETE FROM app_workspace_files WHERE workspace_id = ? AND path = ?`,
      [workspaceId, normalizePath(path)],
    );
  };

  const getLegacyUsage = async (workspaceId: string, excludePaths: string[] = []) => {
    const placeholders = excludePaths.map(() => "?").join(",");
    const conditions =
      excludePaths.length > 0
        ? `AND path NOT IN (${placeholders})`
        : "";
    const rows = await runStatement(
      db,
      `SELECT COUNT(*) as file_count, COALESCE(SUM(length(content)), 0) as total_size
       FROM app_workspace_files
       WHERE workspace_id = ? ${conditions}`,
      [workspaceId, ...excludePaths],
      true,
    );
    const row = rows[0] || {};
    return {
      fileCount: Number(row.file_count || 0),
      totalSize: Number(row.total_size || 0),
    };
  };

  const buildFileRecord = async (
    meta: any,
    fallbackContent?: Uint8Array | null,
  ): Promise<WorkspaceFileRecord | null> => {
    if (!meta) return null;
    const path = normalizePath(meta.path);
    const dir = normalizeDirectoryPath(meta.directory_path ?? parentDirectory(path));
    const fromR2 =
      (await readR2Object(vfsBucket, meta.storage_key ?? buildVfsStorageKey(meta.workspace_id, path))) ??
      null;
    const content = fromR2 ?? fallbackContent ?? emptyBytes;
    const size =
      typeof meta.size === "number" && Number.isFinite(meta.size) && meta.size >= 0
        ? Number(meta.size)
        : content.byteLength;
    return {
      workspace_id: String(meta.workspace_id),
      path,
      directory_path: dir,
      content,
      size,
      content_hash: meta.content_hash ?? null,
      storage_key: meta.storage_key ?? null,
      is_cache: meta.is_cache === 1 || meta.is_cache === true,
      content_type: meta.content_type ?? null,
      created_at: meta.created_at ? String(meta.created_at) : "",
      updated_at: meta.updated_at ? String(meta.updated_at) : "",
    };
  };

  const getWorkspaceFile = async (workspaceId: string, path: string) => {
    const normalizedPath = normalizePath(path);
    const legacy = await fetchLegacyFile(workspaceId, normalizedPath);
    const meta = await getVfsMeta(workspaceId, normalizedPath);
    if (meta) {
      return buildFileRecord(meta, legacy?.content ?? null);
    }
    if (legacy) {
      return {
        ...legacy,
        directory_path: parentDirectory(normalizedPath),
        size: legacy.content?.byteLength ?? 0,
      };
    }
    return null;
  };

  const listWorkspaceFiles = async (workspaceId: string, prefix?: string) => {
    const metas = await listVfsMeta(workspaceId, prefix);
    const legacyRows = await listLegacyFiles(workspaceId, prefix);
    const legacyMap = new Map<string, WorkspaceFileRecord>();
    for (const legacy of legacyRows) {
      const key = normalizePath(legacy.path);
      legacyMap.set(key, legacy);
    }
    const result: WorkspaceFileRecord[] = [];
    for (const meta of metas) {
      const key = normalizePath(String((meta as any).path ?? ""));
      const fallback = legacyMap.get(key);
      const record = await buildFileRecord(meta, fallback?.content ?? null);
      if (record) result.push(record);
      if (fallback) {
        legacyMap.delete(key);
      }
    }

    for (const [legacyPath, legacy] of legacyMap.entries()) {
      result.push({
        ...legacy,
        directory_path: parentDirectory(legacyPath),
        size: legacy.content?.byteLength ?? 0,
      });
    }
    return result;
  };

  const saveWorkspaceFile = async (
    workspaceId: string,
    path: string,
    content: WorkspaceFileContent,
    contentType?: string | null,
    options?: { cacheControl?: string | null },
  ) => {
    const normalizedPath = normalizePath(path);
    const directoryPath = parentDirectory(normalizedPath);
    await ensureDirectoryChain(workspaceId, directoryPath);
    const body = toBytes(content);
    const size = body.byteLength;
    const contentHash = await computeSha256(body);
    const storageKey = buildVfsStorageKey(workspaceId, normalizedPath);
    const wroteToR2 = await writeR2Object(
      vfsBucket,
      storageKey,
      body,
      contentType ?? "application/octet-stream",
      options?.cacheControl ?? null,
    );
    if (!wroteToR2) {
      await upsertLegacyFile(workspaceId, normalizedPath, body, contentType ?? null);
    }
    await upsertVfsMeta(
      workspaceId,
      normalizedPath,
      directoryPath,
      contentType ?? null,
      size,
      contentHash,
      storageKey,
      normalizedPath.startsWith("__cache/"),
    );
    return getWorkspaceFile(workspaceId, normalizedPath);
  };

  const deleteWorkspaceFile = async (workspaceId: string, path: string) => {
    const normalizedPath = normalizePath(path);
    const meta = await getVfsMeta(workspaceId, normalizedPath);
    await runStatement(
      db,
      `DELETE FROM vfs_files WHERE workspace_id = ? AND path = ?`,
      [workspaceId, normalizedPath],
    );
    await deleteLegacyFile(workspaceId, normalizedPath);
    if (meta?.storage_key) {
      await deleteR2Object(vfsBucket, String(meta.storage_key));
    }
    return true;
  };

  const copyWorkspaceFile = async (workspaceId: string, from: string, to: string) => {
    const fromPath = normalizePath(from);
    const toPath = normalizePath(to);
    if (!fromPath || !toPath) {
      throw new Error("from/to path is required");
    }
    const source = await getWorkspaceFile(workspaceId, fromPath);
    if (!source) return null;
    return saveWorkspaceFile(
      workspaceId,
      toPath,
      source.content ?? emptyBytes,
      source.content_type ?? "application/octet-stream",
    );
  };

  const moveWorkspaceFile = async (workspaceId: string, from: string, to: string) => {
    const fromPath = normalizePath(from);
    const toPath = normalizePath(to);
    if (!fromPath || !toPath) {
      throw new Error("from/to path is required");
    }
    const copied = await copyWorkspaceFile(workspaceId, fromPath, toPath);
    if (!copied) return null;
    await deleteWorkspaceFile(workspaceId, fromPath);
    return copied;
  };

  const deleteDirectory = async (
    workspaceId: string,
    path: string,
    options?: { recursive?: boolean },
  ) => {
    const normalizedDir = normalizeDirectoryPath(path);
    if (normalizedDir === "/") {
      throw new Error("cannot delete root directory");
    }
    const normalizedPrefix = normalizePath(normalizedDir);
    const prefix = normalizedPrefix ? `${normalizedPrefix}/` : "";
    const recursive = Boolean(options?.recursive);

    if (!recursive) {
      const childDirs = await runStatement(
        db,
        `SELECT path FROM vfs_directories WHERE workspace_id = ? AND parent_path = ? LIMIT 1`,
        [workspaceId, normalizedDir],
        true,
      );
      const childFiles = await runStatement(
        db,
        `SELECT path FROM vfs_files WHERE workspace_id = ? AND directory_path = ? LIMIT 1`,
        [workspaceId, normalizedDir],
        true,
      );
      const legacyFiles = await runStatement(
        db,
        `SELECT path FROM app_workspace_files WHERE workspace_id = ? AND path LIKE ? ESCAPE '\\' LIMIT 1`,
        [workspaceId, `${escapeLikePattern(prefix)}%`],
        true,
      );
      if (childDirs.length || childFiles.length || legacyFiles.length) {
        throw new Error("directory_not_empty");
      }
    }

    let deletedFiles = 0;
    if (recursive) {
      const vfsRows = await runStatement(
        db,
        `SELECT path FROM vfs_files WHERE workspace_id = ? AND path LIKE ? ESCAPE '\\'`,
        [workspaceId, `${escapeLikePattern(prefix)}%`],
        true,
      );
      for (const row of vfsRows) {
        if (row?.path) {
          await deleteWorkspaceFile(workspaceId, String(row.path));
          deletedFiles += 1;
        }
      }
      const legacyRows = await runStatement(
        db,
        `SELECT path FROM app_workspace_files WHERE workspace_id = ? AND path LIKE ? ESCAPE '\\'`,
        [workspaceId, `${escapeLikePattern(prefix)}%`],
        true,
      );
      for (const row of legacyRows) {
        if (row?.path) {
          await deleteLegacyFile(workspaceId, String(row.path));
          deletedFiles += 1;
        }
      }
    }

    const dirCountRows = await runStatement(
      db,
      recursive
        ? `SELECT COUNT(*) as count FROM vfs_directories WHERE workspace_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\')`
        : `SELECT COUNT(*) as count FROM vfs_directories WHERE workspace_id = ? AND path = ?`,
      recursive
        ? [workspaceId, normalizedDir, `${escapeLikePattern(prefix)}%`]
        : [workspaceId, normalizedDir],
      true,
    );
    const deletedDirectories = Number((dirCountRows[0] as any)?.count ?? 0);

    await runStatement(
      db,
      recursive
        ? `DELETE FROM vfs_directories WHERE workspace_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\')`
        : `DELETE FROM vfs_directories WHERE workspace_id = ? AND path = ?`,
      recursive
        ? [workspaceId, normalizedDir, `${escapeLikePattern(prefix)}%`]
        : [workspaceId, normalizedDir],
    );

    return { deletedFiles, deletedDirectories };
  };

  const deleteWorkspace = async (workspaceId: string) => {
    const normalizedId = String(workspaceId).trim();
    if (!normalizedId) return false;

    try {
      const metas = await listVfsMeta(normalizedId);
      for (const meta of metas) {
        if (meta?.storage_key) {
          await deleteR2Object(vfsBucket, String(meta.storage_key));
        }
      }
    } catch (error) {
      console.warn("[workspace] failed to cleanup VFS storage objects", error);
    }

    try {
      await runStatement(db, `DELETE FROM vfs_files WHERE workspace_id = ?`, [normalizedId]);
      await runStatement(db, `DELETE FROM vfs_directories WHERE workspace_id = ?`, [normalizedId]);
      await runStatement(db, `DELETE FROM app_workspace_snapshots WHERE workspace_id = ?`, [normalizedId]);
      await runStatement(db, `DELETE FROM app_workspace_files WHERE workspace_id = ?`, [normalizedId]);
      await runStatement(db, `DELETE FROM app_workspaces WHERE id = ?`, [normalizedId]);
    } catch (error) {
      console.warn("[workspace] failed to delete workspace records", error);
      return false;
    }

    return true;
  };

  const statWorkspaceFile = async (workspaceId: string, path: string) => {
    const normalizedPath = normalizePath(path);
    const meta = await getVfsMeta(workspaceId, normalizedPath);
    if (meta) {
      return {
        workspace_id: String(meta.workspace_id),
        path: normalizedPath,
        directory_path: normalizeDirectoryPath(String(meta.directory_path ?? "") || parentDirectory(normalizedPath)),
        content: emptyBytes,
        size: Number(meta.size ?? 0),
        content_hash: meta.content_hash ? String(meta.content_hash) : null,
        storage_key: meta.storage_key ? String(meta.storage_key) : null,
        is_cache: meta.is_cache === 1 || meta.is_cache === true,
        content_type: meta.content_type ? String(meta.content_type) : null,
        created_at: meta.created_at ? String(meta.created_at) : "",
        updated_at: meta.updated_at ? String(meta.updated_at) : "",
      };
    }
    const legacy = await fetchLegacyFile(workspaceId, normalizedPath);
    if (!legacy) return null;
    return {
      ...legacy,
      directory_path: parentDirectory(normalizedPath),
      size: legacy.content?.byteLength ?? 0,
    };
  };

  const getWorkspaceUsage = async (workspaceId: string): Promise<WorkspaceUsage> => {
    const vfsRows = await runStatement(
      db,
      `SELECT COUNT(*) as file_count, COALESCE(SUM(size), 0) as total_size
       FROM vfs_files
       WHERE workspace_id = ?`,
      [workspaceId],
      true,
    );
    const vfsRow = vfsRows[0] || {};
    const vfsCount = Number(vfsRow.file_count || 0);
    const vfsSize = Number(vfsRow.total_size || 0);
    const pathRows = await runStatement(
      db,
      `SELECT path FROM vfs_files WHERE workspace_id = ?`,
      [workspaceId],
      true,
    );
    const excludePaths = (pathRows || []).map((row: any) => normalizePath(row.path));
    const legacyUsage = await getLegacyUsage(workspaceId, excludePaths);
    return {
      fileCount: vfsCount + legacyUsage.fileCount,
      totalSize: vfsSize + legacyUsage.totalSize,
    };
  };

  const listDirectories = async (workspaceId: string, path?: string) => {
    const normalized = normalizeDirectoryPath(path || "/");
    await ensureDirectoryChain(workspaceId, normalized);
    const parent = normalized === "/" ? "/" : normalized;
    const rows = await runStatement(
      db,
      `SELECT workspace_id, path, name, parent_path, created_at, updated_at
       FROM vfs_directories
       WHERE workspace_id = ? AND parent_path = ?
       ORDER BY path`,
      [workspaceId, parent],
      true,
    );
    return rows as VfsDirectoryRecord[];
  };

  const ensureDirectory = async (workspaceId: string, path: string) => {
    const normalized = normalizeDirectoryPath(path);
    await ensureDirectoryChain(workspaceId, normalized);
    const rows = await runStatement(
      db,
      `SELECT workspace_id, path, name, parent_path, created_at, updated_at
       FROM vfs_directories
       WHERE workspace_id = ? AND path = ?
       LIMIT 1`,
      [workspaceId, normalized],
      true,
    );
    const row = rows[0] as VfsDirectoryRecord | undefined;
    return row ?? null;
  };

  const saveWorkspaceSnapshot = async (
    workspaceId: string,
    status: AppWorkspaceStatus,
  ): Promise<WorkspaceSnapshotRecord | null> => {
    if (!vfsBucket) return null;
    const files = await listWorkspaceFiles(workspaceId);
    const snapshotPayload = {
      workspaceId,
      status,
      createdAt: new Date().toISOString(),
      files: await Promise.all(
        files.map(async (file) => ({
          path: file.path,
          contentType: file.content_type,
          size: file.size ?? file.content?.byteLength ?? 0,
          contentHash: file.content_hash ?? (await computeSha256(file.content ?? emptyBytes)),
          content: toBase64(file.content ?? emptyBytes),
        })),
      ),
    };
    const serialized = encoder.encode(JSON.stringify(snapshotPayload));
    const storageKey = buildSnapshotKey(workspaceId, status);
    const wrote = await writeR2Object(
      vfsBucket,
      storageKey,
      serialized,
      "application/json",
      "private, max-age=0, must-revalidate",
    );
    if (!wrote) {
      return null;
    }
    const snapshotId = crypto.randomUUID();
    await runStatement(
      db,
      `INSERT INTO app_workspace_snapshots (id, workspace_id, status, storage_key, size_bytes, file_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [snapshotId, workspaceId, status, storageKey, serialized.byteLength, files.length],
    );
    return {
      id: snapshotId,
      workspace_id: workspaceId,
      status,
      storage_key: storageKey,
      size_bytes: serialized.byteLength,
      file_count: files.length,
      created_at: new Date().toISOString(),
    };
  };

  const saveCompileCache = async (
    workspaceId: string,
    hash: string,
    content: WorkspaceFileContent,
    options?: { contentType?: string | null; cacheControl?: string | null },
  ): Promise<WorkspaceFileRecord | null> => {
    const cacheName = hash.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 128) || "default";
    const key = buildCompileCacheKey(workspaceId, cacheName);
    const pathForMeta = `__cache/esbuild/${cacheName}.js`;
    const contentType = options?.contentType ?? "application/javascript";
    const cacheControl = options?.cacheControl ?? "public, max-age=3600";
    const body = toBytes(content);
    const wrote = await writeR2Object(vfsBucket, key, body, contentType, cacheControl);
    if (!wrote) {
      await upsertLegacyFile(workspaceId, pathForMeta, body, contentType);
    }
    await upsertVfsMeta(
      workspaceId,
      pathForMeta,
      parentDirectory(pathForMeta),
      contentType,
      body.byteLength,
      await computeSha256(body),
      key,
      true,
    );
    return getWorkspaceFile(workspaceId, pathForMeta);
  };

  const getCompileCache = async (workspaceId: string, hash: string) => {
    const cacheName = hash.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 128) || "default";
    const pathForMeta = `__cache/esbuild/${cacheName}.js`;
    return getWorkspaceFile(workspaceId, pathForMeta);
  };

  return {
    getWorkspace,
    listWorkspaces,
    upsertWorkspace,
    updateWorkspaceStatus,
    saveWorkspaceFile,
    getWorkspaceFile,
    listWorkspaceFiles,
    deleteWorkspaceFile,
    deleteWorkspace,
    copyWorkspaceFile,
    moveWorkspaceFile,
    deleteDirectory,
    statWorkspaceFile,
    getWorkspaceUsage,
    listDirectories,
    ensureDirectory,
    saveWorkspaceSnapshot,
    saveCompileCache,
    getCompileCache,
  };
}

export function resolveWorkspaceEnv(
  options?: LoadWorkspaceOptions & { requireIsolation?: boolean },
): WorkspaceResolution {
  const mode: PreviewMode = options?.mode === "prod" ? "prod" : "dev";
  const env: WorkspaceEnv = { ...(options?.env ?? {}) };
  if (mode === "dev") {
    (env as any).TAKOS_CONTEXT = "dev";
  }
  const storeProvided = Boolean(options?.store || (env as any).workspaceStore);
  const shouldRequireIsolation = mode === "dev" && (options?.requireIsolation ?? !storeProvided);

  let isolation: DevDataIsolationResult | null = null;

  if (shouldRequireIsolation) {
    isolation = resolveDevDataIsolation(
      { ...env, TAKOS_CONTEXT: "dev" },
      { required: options?.requireIsolation ?? true },
    );
    if (isolation.required) {
      if (!isolation.ok) {
        return { env, store: null, isolation };
      }
      if (isolation.resolved.db) {
        env.DB = isolation.resolved.db as any;
      }
      if (isolation.resolved.media) {
        env.MEDIA = isolation.resolved.media as any;
      }
      if (isolation.resolved.kv) {
        env.KV = isolation.resolved.kv as any;
      }
      if (isolation.warnings.length) {
        console.warn(`[dev-data] ${isolation.warnings.join("; ")}`);
      }
    }
  }

  const vfsBucket = resolveWorkspaceBucket(env, isolation);
  if (vfsBucket && !(env as any).VFS_BUCKET) {
    (env as any).VFS_BUCKET = vfsBucket as any;
  }

  const store =
    (options?.store as WorkspaceStore | null | undefined) ??
    ((env as any).workspaceStore as WorkspaceStore | null | undefined) ??
    (env.DB ? createWorkspaceStore(env.DB, vfsBucket) : null);

  return { env, store: store ?? null, isolation };
}

export async function ensureDefaultWorkspace(store: WorkspaceStore | null): Promise<boolean> {
  if (
    !store ||
    typeof store.getWorkspace !== "function" ||
    typeof store.upsertWorkspace !== "function" ||
    typeof store.getWorkspaceFile !== "function" ||
    typeof store.saveWorkspaceFile !== "function"
  ) {
    return false;
  }

  const workspaceId = getDemoWorkspace().id || "ws_demo";
  let seeded = false;

  try {
    const existing = await store.getWorkspace(workspaceId);
    if (!existing) {
      const now = new Date().toISOString();
      await store.upsertWorkspace({
        id: workspaceId,
        status: "validated",
        author_type: "agent",
        author_name: "system",
        created_at: now,
        updated_at: now,
      });
      seeded = true;
    }

    const manifest = await store.getWorkspaceFile(workspaceId, DEFAULT_MANIFEST_PATH);
    if (!manifest) {
      await store.saveWorkspaceFile(
        workspaceId,
        DEFAULT_MANIFEST_PATH,
        JSON.stringify(getDemoWorkspace()),
        "application/json",
      );
      seeded = true;
    }
  } catch (error) {
    console.warn("[workspace] failed to seed default workspace", error);
    return false;
  }

  return seeded;
}

const resolveWorkspaceStore = (options?: LoadWorkspaceOptions): WorkspaceStore | null =>
  resolveWorkspaceEnv(options).store;
export { resolveWorkspaceStore };

const loadProdManifest = async (env?: WorkspaceEnv | null): Promise<AppWorkspaceManifest | null> => {
  if (!env) return null;

  let store: any = null;
  try {
    store = makeData(env as any);
    if (!store?.getActiveAppRevision) return null;

    const state = await store.getActiveAppRevision();
    const snapshot =
      state?.revision?.manifest_snapshot ??
      state?.manifest_snapshot ??
      state?.revision?.manifestSnapshot ??
      null;
    if (!snapshot) {
      return null;
    }

    const manifest = parseManifestJson(
      typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot),
      state?.active_revision_id ?? state?.revision?.id ?? "prod",
    );
    if (manifest && !manifest.id) {
      manifest.id = state?.active_revision_id ?? state?.revision?.id ?? "prod";
    }
    return manifest;
  } catch (error) {
    console.error("[workspace] failed to load prod manifest", error);
    return null;
  } finally {
    if (store) {
      try {
        await releaseStore(store);
      } catch {
        // ignore cleanup errors
      }
    }
  }
};

export async function loadWorkspaceUiContract(
  workspaceId: string,
  options?: LoadWorkspaceOptions,
): Promise<{ contract: UiContract | null; issues: AppManifestValidationIssue[] }> {
  const issues: AppManifestValidationIssue[] = [];
  const mode: PreviewMode = options?.mode === "prod" ? "prod" : "dev";
  const { store, isolation } = resolveWorkspaceEnv({ ...options, mode });
  if (isolation?.required && !isolation.ok) {
    issues.push({
      severity: "error",
      message: isolation.errors[0] || "dev data isolation failed",
    });
    return { contract: null, issues };
  }
  if (!store || !workspaceId) {
    return { contract: null, issues };
  }

  try {
    const file = await store.getWorkspaceFile(workspaceId, DEFAULT_UI_CONTRACT_PATH);
    if (!file) {
      return { contract: null, issues };
    }
    const text = decoder.decode(file.content);
    const parsed = parseUiContractJson(text, DEFAULT_UI_CONTRACT_PATH);
    issues.push(...parsed.issues);
    return { contract: parsed.contract ?? null, issues };
  } catch (error) {
    issues.push({
      severity: "warning",
      message: `failed to load ${DEFAULT_UI_CONTRACT_PATH}: ${(error as Error).message}`,
      file: DEFAULT_UI_CONTRACT_PATH,
    });
    return { contract: null, issues };
  }
}

export async function loadWorkspaceManifest(
  workspaceId: string,
  options?: LoadWorkspaceOptions,
): Promise<AppWorkspaceManifest | null> {
  const mode: PreviewMode = options?.mode === "prod" ? "prod" : "dev";
  const { env, store, isolation } = resolveWorkspaceEnv({ ...options, mode });
  const normalizedId = typeof workspaceId === "string" ? workspaceId.trim() : "";

  if (isolation?.required && !isolation.ok) {
    console.error("[workspace] dev data isolation failed", isolation.errors);
    return null;
  }

  if (mode === "prod") {
    const prodManifest = await loadProdManifest(env ?? null);
    if (prodManifest) {
      return prodManifest;
    }
  }

  if (normalizedId && defaultWorkspaceIds.has(normalizedId)) {
    return getDemoWorkspace();
  }

  if (!store || !normalizedId) return null;
  if (mode === "dev") {
    await ensureDefaultWorkspace(store);
  }

  const workspace = await store.getWorkspace(normalizedId);
  if (!workspace) return null;

  const file = await store.getWorkspaceFile(normalizedId, DEFAULT_MANIFEST_PATH);
  const manifest = parseWorkspaceFileManifest(file, normalizedId);
  if (!manifest) return null;
  if (!manifest.id) {
    manifest.id = workspace.id;
  }
  if (!(manifest as any).status && workspace.status) {
    (manifest as any).status = workspace.status;
  }
  return manifest;
}

export function getDemoWorkspace(): AppWorkspaceManifest {
  return demoWorkspace;
}
