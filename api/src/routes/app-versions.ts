import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { fail, ok, type JsonValue } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { requireHumanSession, requireWorkspacePlan } from "../lib/workspace-guard";
import { resolveWorkspaceEnv } from "../lib/workspace-store";

type SnapshotFileEntry = {
  path: string;
  contentHash: string | null;
  size: number | null;
  contentType: string | null;
};

const toStringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);
const toNumberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const normalizeSnapshotFiles = (payload: Record<string, unknown> | null): SnapshotFileEntry[] => {
  const files = (payload as any)?.files;
  if (!Array.isArray(files)) return [];
  const out: SnapshotFileEntry[] = [];
  for (const entry of files) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const path = toStringOrNull((entry as any).path)?.trim() ?? "";
    if (!path) continue;
    out.push({
      path,
      contentHash: toStringOrNull((entry as any).contentHash) ?? toStringOrNull((entry as any).content_hash),
      size: toNumberOrNull((entry as any).size),
      contentType: toStringOrNull((entry as any).contentType) ?? toStringOrNull((entry as any).content_type),
    });
  }
  return out;
};

const buildFileMap = (files: SnapshotFileEntry[]): Map<string, SnapshotFileEntry> => {
  const map = new Map<string, SnapshotFileEntry>();
  for (const entry of files) {
    if (!map.has(entry.path)) {
      map.set(entry.path, entry);
    }
  }
  return map;
};

const diffFiles = (fromFiles: SnapshotFileEntry[], toFiles: SnapshotFileEntry[]) => {
  const before = buildFileMap(fromFiles);
  const after = buildFileMap(toFiles);
  const paths = Array.from(new Set([...before.keys(), ...after.keys()])).sort();

  const added: SnapshotFileEntry[] = [];
  const removed: SnapshotFileEntry[] = [];
  const changed: Array<{ path: string; before: SnapshotFileEntry; after: SnapshotFileEntry }> = [];

  for (const path of paths) {
    const b = before.get(path) ?? null;
    const a = after.get(path) ?? null;
    if (b && !a) {
      removed.push(b);
      continue;
    }
    if (!b && a) {
      added.push(a);
      continue;
    }
    if (b && a) {
      const hashChanged = (b.contentHash ?? "") !== (a.contentHash ?? "");
      const sizeChanged = (b.size ?? null) !== (a.size ?? null);
      const contentTypeChanged = (b.contentType ?? null) !== (a.contentType ?? null);
      if (hashChanged || sizeChanged || contentTypeChanged) {
        changed.push({ path, before: b, after: a });
      }
    }
  }

  return { added, removed, changed };
};

const normalizeLimit = (value: string | null): number => {
  const n = value ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(Math.floor(n), 200);
};

const appVersionsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

appVersionsRoutes.get(
  "/-/dev/versions/:workspaceId/log",
  auth,
  requireHumanSession,
  requireWorkspacePlan,
  async (c) => {
    const workspaceId = (c.req.param("workspaceId") ?? "").trim();
    if (!workspaceId) {
      return fail(c as any, "workspaceId is required", 400);
    }

    const workspaceEnv = resolveWorkspaceEnv({ env: c.env, mode: "dev", requireIsolation: true });
    if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
      return fail(c as any, workspaceEnv.isolation.errors[0] || "dev data isolation failed", 503);
    }
    const store = workspaceEnv.store;
    if (!store?.getWorkspace || !store.listWorkspaceSnapshots) {
      return fail(c as any, "workspace snapshots are not supported", 501);
    }

    const workspace = await store.getWorkspace(workspaceId);
    if (!workspace) {
      return fail(c as any, "workspace not found", 404);
    }

    const limit = normalizeLimit(c.req.query("limit") ?? null);
    const snapshots = await store.listWorkspaceSnapshots(workspaceId, { limit });
    return ok(c as any, { workspaceId, snapshots } satisfies JsonValue);
  },
);

appVersionsRoutes.get(
  "/-/dev/versions/:workspaceId/diff",
  auth,
  requireHumanSession,
  requireWorkspacePlan,
  async (c) => {
    const workspaceId = (c.req.param("workspaceId") ?? "").trim();
    if (!workspaceId) {
      return fail(c as any, "workspaceId is required", 400);
    }
    const from = (c.req.query("from") ?? "").trim();
    const to = (c.req.query("to") ?? "").trim();
    if (!from || !to) {
      return fail(c as any, "from and to are required", 400);
    }

    const workspaceEnv = resolveWorkspaceEnv({ env: c.env, mode: "dev", requireIsolation: true });
    if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
      return fail(c as any, workspaceEnv.isolation.errors[0] || "dev data isolation failed", 503);
    }
    const store = workspaceEnv.store;
    if (!store?.getWorkspace || !store.readWorkspaceSnapshotPayload || !store.getWorkspaceSnapshotRecord) {
      return fail(c as any, "workspace snapshot diff is not supported", 501);
    }

    const workspace = await store.getWorkspace(workspaceId);
    if (!workspace) {
      return fail(c as any, "workspace not found", 404);
    }

    const [fromRecord, toRecord] = await Promise.all([
      store.getWorkspaceSnapshotRecord(from),
      store.getWorkspaceSnapshotRecord(to),
    ]);
    if (!fromRecord || !toRecord) {
      return fail(c as any, "snapshot not found", 404);
    }
    if (fromRecord.workspace_id !== workspaceId || toRecord.workspace_id !== workspaceId) {
      return fail(c as any, "snapshot does not belong to workspace", 400);
    }

    const [fromPayload, toPayload] = await Promise.all([
      store.readWorkspaceSnapshotPayload(from),
      store.readWorkspaceSnapshotPayload(to),
    ]);
    if (!fromPayload || !toPayload) {
      return fail(c as any, "snapshot payload not available", 503);
    }

    const fromFiles = normalizeSnapshotFiles(fromPayload);
    const toFiles = normalizeSnapshotFiles(toPayload);
    const diff = diffFiles(fromFiles, toFiles);

    return ok(c as any, {
      workspaceId,
      from: { id: fromRecord.id, created_at: fromRecord.created_at, status: fromRecord.status },
      to: { id: toRecord.id, created_at: toRecord.created_at, status: toRecord.status },
      summary: { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length },
      diff,
    } satisfies JsonValue);
  },
);

export default appVersionsRoutes;

