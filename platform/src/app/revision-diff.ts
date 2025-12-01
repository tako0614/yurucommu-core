import type { AppManifest } from "./types";

export type ManifestSectionDiff = {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
};

export type AppRevisionManifestDiff = {
  issues: string[];
  scriptChanged: boolean;
  manifestVersionChanged: boolean;
  routes: ManifestSectionDiff;
  screens: ManifestSectionDiff;
  apHandlers: ManifestSectionDiff;
  collections: ManifestSectionDiff;
  buckets: ManifestSectionDiff;
};

type RevisionSnapshot = {
  id?: string | null;
  manifestSnapshot: string | AppManifest | null | undefined;
  scriptSnapshotRef?: string | null;
};

const emptySection: ManifestSectionDiff = {
  added: [],
  removed: [],
  changed: [],
  unchanged: [],
};

function normalizeRef(ref?: string | null): string {
  return typeof ref === "string" ? ref.trim() : "";
}

function parseManifest(snapshot: string | AppManifest | null | undefined): {
  manifest: AppManifest | null;
  issue?: string;
} {
  if (snapshot === null || snapshot === undefined) {
    return { manifest: null, issue: "manifest missing" };
  }
  if (typeof snapshot !== "string") {
    return { manifest: snapshot as AppManifest };
  }
  try {
    return { manifest: JSON.parse(snapshot) as AppManifest };
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    return { manifest: null, issue: `manifest parse error: ${message}` };
  }
}

function diffById<T extends Record<string, unknown>>(
  from: T[] | undefined,
  to: T[] | undefined,
  key: keyof T,
): ManifestSectionDiff {
  const left = new Map<string, T>();
  const right = new Map<string, T>();

  for (const item of from ?? []) {
    const id = String(item[key] ?? "").trim();
    if (!id) continue;
    left.set(id, item);
  }
  for (const item of to ?? []) {
    const id = String(item[key] ?? "").trim();
    if (!id) continue;
    right.set(id, item);
  }

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const id of left.keys()) {
    if (!right.has(id)) {
      removed.push(id);
      continue;
    }
    const a = JSON.stringify(left.get(id));
    const b = JSON.stringify(right.get(id));
    if (a === b) {
      unchanged.push(id);
    } else {
      changed.push(id);
    }
  }

  for (const id of right.keys()) {
    if (!left.has(id)) {
      added.push(id);
    }
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
    unchanged: unchanged.sort(),
  };
}

function diffByKey(
  from: Record<string, unknown> | undefined,
  to: Record<string, unknown> | undefined,
): ManifestSectionDiff {
  const left = new Map<string, unknown>(Object.entries(from ?? {}));
  const right = new Map<string, unknown>(Object.entries(to ?? {}));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const [key, value] of left.entries()) {
    if (!right.has(key)) {
      removed.push(key);
      continue;
    }
    const other = right.get(key);
    const a = JSON.stringify(value);
    const b = JSON.stringify(other);
    if (a === b) {
      unchanged.push(key);
    } else {
      changed.push(key);
    }
  }

  for (const key of right.keys()) {
    if (!left.has(key)) {
      added.push(key);
    }
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
    unchanged: unchanged.sort(),
  };
}

export function diffAppRevisionManifests(
  from: RevisionSnapshot,
  to: RevisionSnapshot,
): AppRevisionManifestDiff {
  const issues: string[] = [];

  const parsedFrom = parseManifest(from?.manifestSnapshot);
  const parsedTo = parseManifest(to?.manifestSnapshot);

  if (parsedFrom.issue) issues.push(`from(${from?.id ?? "unknown"}): ${parsedFrom.issue}`);
  if (parsedTo.issue) issues.push(`to(${to?.id ?? "unknown"}): ${parsedTo.issue}`);

  const scriptChanged = normalizeRef(from?.scriptSnapshotRef) !== normalizeRef(to?.scriptSnapshotRef);

  const fromManifest = parsedFrom.manifest;
  const toManifest = parsedTo.manifest;

  const manifestVersionChanged =
    (fromManifest?.version ?? null) !== (toManifest?.version ?? null) ||
    (fromManifest?.schemaVersion ?? null) !== (toManifest?.schemaVersion ?? null);

  if (!fromManifest || !toManifest) {
    return {
      issues,
      scriptChanged,
      manifestVersionChanged,
      routes: emptySection,
      screens: emptySection,
      apHandlers: emptySection,
      collections: emptySection,
      buckets: emptySection,
    };
  }

  return {
    issues,
    scriptChanged,
    manifestVersionChanged,
    routes: diffById(fromManifest.routes, toManifest.routes, "id"),
    screens: diffById(fromManifest.views?.screens, toManifest.views?.screens, "id"),
    apHandlers: diffById(fromManifest.ap?.handlers, toManifest.ap?.handlers, "id"),
    collections: diffByKey(fromManifest.data?.collections, toManifest.data?.collections),
    buckets: diffByKey(fromManifest.storage?.buckets, toManifest.storage?.buckets),
  };
}
