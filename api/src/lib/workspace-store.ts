/// <reference types="@cloudflare/workers-types" />

import type { PublicAccountBindings } from "@takos/platform/server";
import { releaseStore } from "@takos/platform/server";
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
  created_at: string;
  updated_at: string;
};

export type WorkspaceFileContent = string | ArrayBuffer | ArrayBufferView | Uint8Array;

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
  ): Promise<WorkspaceFileRecord | null>;
  getWorkspaceFile(workspaceId: string, path: string): Promise<WorkspaceFileRecord | null>;
  listWorkspaceFiles(workspaceId: string, prefix?: string): Promise<WorkspaceFileRecord[]>;
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
export const DEFAULT_MANIFEST_PATH = "takos-app.json";

type WorkspaceEnv = Partial<PublicAccountBindings> & {
  DB?: D1Database;
  workspaceStore?: WorkspaceStore;
};

export type LoadWorkspaceOptions = {
  mode: PreviewMode;
  env?: WorkspaceEnv | null;
  store?: WorkspaceStore | null;
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

const normalizePath = (path: string): string => path.replace(/^\/+/, "").trim();

const escapeLikePattern = (value: string): string => value.replace(/([%_\\])/g, "\\$1");

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
  return {
    workspace_id: String(row.workspace_id),
    path: String(row.path),
    content,
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

export function createWorkspaceStore(db: D1Database): WorkspaceStore {
  if (!db) throw new Error("D1 database binding (DB) is required for workspace store");

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

  const getWorkspaceFile = async (workspaceId: string, path: string) => {
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

  const listWorkspaceFiles = async (workspaceId: string, prefix?: string) => {
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

  const saveWorkspaceFile = async (
    workspaceId: string,
    path: string,
    content: WorkspaceFileContent,
    contentType?: string | null,
  ) => {
    const normalizedPath = normalizePath(path);
    const body = toBytes(content);
    await runStatement(
      db,
      `INSERT INTO app_workspace_files (workspace_id, path, content, content_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(workspace_id, path) DO UPDATE SET
         content = excluded.content,
         content_type = excluded.content_type,
         updated_at = excluded.updated_at`,
      [workspaceId, normalizedPath, body, contentType ?? null],
    );
    return getWorkspaceFile(workspaceId, normalizedPath);
  };

  return {
    getWorkspace,
    listWorkspaces,
    upsertWorkspace,
    updateWorkspaceStatus,
    saveWorkspaceFile,
    getWorkspaceFile,
    listWorkspaceFiles,
  };
}

const resolveWorkspaceStore = (options?: LoadWorkspaceOptions): WorkspaceStore | null => {
  if (!options) return null;
  if (options.store) return options.store;
  const fromEnv = (options.env as any)?.workspaceStore;
  if (fromEnv) return fromEnv as WorkspaceStore;
  if (options.env?.DB) {
    return createWorkspaceStore(options.env.DB);
  }
  return null;
};
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

export async function loadWorkspaceManifest(
  workspaceId: string,
  options?: LoadWorkspaceOptions,
): Promise<AppWorkspaceManifest | null> {
  const mode: PreviewMode = options?.mode === "prod" ? "prod" : "dev";
  const normalizedId = typeof workspaceId === "string" ? workspaceId.trim() : "";

  if (mode === "prod") {
    const prodManifest = await loadProdManifest(options?.env ?? null);
    if (prodManifest) {
      return prodManifest;
    }
  }

  if (normalizedId && defaultWorkspaceIds.has(normalizedId)) {
    return getDemoWorkspace();
  }

  const store = resolveWorkspaceStore(options);
  if (!store || !normalizedId) return null;

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
