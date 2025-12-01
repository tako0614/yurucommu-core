import type {
  AppApHandlerDefinition,
  AppBucketDefinition,
  AppCollectionDefinition,
  AppManifest,
  AppRouteDefinition,
  AppScreenDefinition,
  AppViewInsertDefinition,
} from "@takos/platform/app";

export type AppRevisionRecord = {
  id: string;
  created_at?: string | Date;
  createdAt?: string | Date;
  author_type?: string | null;
  authorType?: string | null;
  author_name?: string | null;
  authorName?: string | null;
  message?: string | null;
  schema_version?: string | null;
  schemaVersion?: string | null;
  manifest_snapshot?: string | null;
  manifestSnapshot?: string | null;
  script_snapshot_ref?: string | null;
  scriptSnapshotRef?: string | null;
};

type ParsedManifest = {
  schemaVersion: string | null;
  routes: AppRouteDefinition[];
  screens: AppScreenDefinition[];
  inserts: AppViewInsertDefinition[];
  apHandlers: AppApHandlerDefinition[];
  dataCollections: Record<string, AppCollectionDefinition>;
  storageBuckets: Record<string, AppBucketDefinition>;
};

type DiffChange = "added" | "removed" | "changed";

export type DiffEntry<T> = {
  id: string;
  change: DiffChange;
  before?: T;
  after?: T;
};

export type SectionDiff<T> = {
  added: DiffEntry<T>[];
  removed: DiffEntry<T>[];
  changed: DiffEntry<T>[];
};

export type AppRevisionSummary = {
  id: string;
  created_at: string | null;
  author_type: string | null;
  author_name: string | null;
  message: string | null;
  schema_version: string | null;
  script_snapshot_ref: string | null;
};

export type AppRevisionDiffData = {
  newer: AppRevisionSummary;
  older: AppRevisionSummary | null;
  schema_versions: { newer: string | null; older: string | null };
  script_snapshot: { newer: string | null; older: string | null; changed: boolean };
  sections: {
    routes: SectionDiff<AppRouteDefinition>;
    views: {
      screens: SectionDiff<AppScreenDefinition>;
      inserts: SectionDiff<AppViewInsertDefinition>;
    };
    apHandlers: SectionDiff<AppApHandlerDefinition>;
    dataCollections: SectionDiff<AppCollectionDefinition>;
    storageBuckets: SectionDiff<AppBucketDefinition>;
  };
  summary: { totalChanges: number; sectionTotals: Record<string, number> };
  warnings: string[];
};

export type AppRevisionDiffResult =
  | { ok: true; diff: AppRevisionDiffData }
  | { ok: false; error: string; warnings: string[] };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
};

const normalizeId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toIsoString = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  try {
    const date = new Date(value as any);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
};

const emptyManifest: ParsedManifest = {
  schemaVersion: null,
  routes: [],
  screens: [],
  inserts: [],
  apHandlers: [],
  dataCollections: {},
  storageBuckets: {},
};

const parseManifestSnapshot = (
  raw: string | null | undefined,
): { ok: true; manifest: ParsedManifest; warnings: string[] } | { ok: false; error: string } => {
  if (!raw) {
    return { ok: false, error: "manifest snapshot missing" };
  }

  let parsed: Partial<AppManifest> | null = null;
  try {
    parsed = JSON.parse(raw) as Partial<AppManifest>;
  } catch (error: any) {
    return {
      ok: false,
      error: `failed to parse manifest snapshot: ${error?.message || error}`,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "manifest snapshot is not an object" };
  }

  const warnings: string[] = [];

  const routes = Array.isArray(parsed.routes)
    ? parsed.routes.filter(isPlainObject) as AppRouteDefinition[]
    : [];
  if (!Array.isArray(parsed.routes)) {
    warnings.push("manifest.routes missing or not an array; using empty list");
  }

  const screens = Array.isArray(parsed.views?.screens)
    ? parsed.views.screens.filter(isPlainObject) as AppScreenDefinition[]
    : [];
  if (!Array.isArray(parsed.views?.screens)) {
    warnings.push("manifest.views.screens missing or not an array; using empty list");
  }

  const inserts = Array.isArray(parsed.views?.insert)
    ? parsed.views.insert.filter(isPlainObject) as AppViewInsertDefinition[]
    : [];
  if (!Array.isArray(parsed.views?.insert)) {
    warnings.push("manifest.views.insert missing or not an array; using empty list");
  }

  const apHandlers = Array.isArray(parsed.ap?.handlers)
    ? parsed.ap.handlers.filter(isPlainObject) as AppApHandlerDefinition[]
    : [];
  if (!Array.isArray(parsed.ap?.handlers)) {
    warnings.push("manifest.ap.handlers missing or not an array; using empty list");
  }

  const dataCollections = isPlainObject(parsed.data?.collections)
    ? (parsed.data?.collections as Record<string, AppCollectionDefinition>)
    : {};
  if (!isPlainObject(parsed.data?.collections)) {
    warnings.push("manifest.data.collections missing or not an object; using empty map");
  }

  const storageBuckets = isPlainObject(parsed.storage?.buckets)
    ? (parsed.storage?.buckets as Record<string, AppBucketDefinition>)
    : {};
  if (!isPlainObject(parsed.storage?.buckets)) {
    warnings.push("manifest.storage.buckets missing or not an object; using empty map");
  }

  const schemaVersion =
    normalizeId((parsed as any).schemaVersion) || normalizeId((parsed as any).schema_version);

  return {
    ok: true,
    manifest: {
      schemaVersion,
      routes,
      screens,
      inserts,
      apHandlers,
      dataCollections,
      storageBuckets,
    },
    warnings,
  };
};

const diffByKey = <T>(
  previous: T[],
  next: T[],
  keyFn: (value: T) => string | null,
): SectionDiff<T> => {
  const beforeMap = new Map<string, T>();
  const afterMap = new Map<string, T>();

  for (const item of previous) {
    const key = keyFn(item);
    if (key && !beforeMap.has(key)) {
      beforeMap.set(key, item);
    }
  }

  for (const item of next) {
    const key = keyFn(item);
    if (key && !afterMap.has(key)) {
      afterMap.set(key, item);
    }
  }

  const ids = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()])).sort();
  const added: DiffEntry<T>[] = [];
  const removed: DiffEntry<T>[] = [];
  const changed: DiffEntry<T>[] = [];

  for (const id of ids) {
    const before = beforeMap.get(id);
    const after = afterMap.get(id);
    if (before && after) {
      if (!deepEqual(before, after)) {
        changed.push({ id, change: "changed", before, after });
      }
    } else if (after) {
      added.push({ id, change: "added", after });
    } else if (before) {
      removed.push({ id, change: "removed", before });
    }
  }

  return { added, removed, changed };
};

const diffRecord = <T>(
  previous: Record<string, T>,
  next: Record<string, T>,
): SectionDiff<T> => {
  const ids = Array.from(new Set([...Object.keys(previous), ...Object.keys(next)])).sort();
  const added: DiffEntry<T>[] = [];
  const removed: DiffEntry<T>[] = [];
  const changed: DiffEntry<T>[] = [];

  for (const id of ids) {
    const before = previous[id];
    const after = next[id];
    if (before !== undefined && after !== undefined) {
      if (!deepEqual(before, after)) {
        changed.push({ id, change: "changed", before, after });
      }
    } else if (after !== undefined) {
      added.push({ id, change: "added", after });
    } else if (before !== undefined) {
      removed.push({ id, change: "removed", before });
    }
  }

  return { added, removed, changed };
};

const getRouteKey = (route: AppRouteDefinition): string | null =>
  normalizeId((route as any).id) ||
  (normalizeId((route as any).path) && `${(route as any).method || "GET"} ${(route as any).path}`);

const getScreenKey = (screen: AppScreenDefinition): string | null => normalizeId((screen as any).id);

const getInsertKey = (insert: AppViewInsertDefinition): string | null => {
  const screen = normalizeId((insert as any).screen);
  if (!screen) return null;
  const position = normalizeId((insert as any).position) || "root";
  const rawOrder = (insert as any).order;
  const order = Number.isFinite(rawOrder) ? Number(rawOrder) : 0;
  return `${screen}::${position}::${order}`;
};

const getApHandlerKey = (handler: AppApHandlerDefinition): string | null =>
  normalizeId((handler as any).id) || normalizeId((handler as any).handler);

const countSectionDiff = (diff: SectionDiff<unknown>): number =>
  diff.added.length + diff.removed.length + diff.changed.length;

const summarizeRevision = (revision: AppRevisionRecord): AppRevisionSummary => ({
  id: revision.id,
  created_at: toIsoString(revision.created_at ?? revision.createdAt),
  author_type: normalizeId(revision.author_type ?? revision.authorType),
  author_name: normalizeId(revision.author_name ?? revision.authorName),
  message: revision.message ?? null,
  schema_version: normalizeId(revision.schema_version ?? revision.schemaVersion),
  script_snapshot_ref: normalizeId(revision.script_snapshot_ref ?? revision.scriptSnapshotRef),
});

export function buildAppRevisionDiff(
  newer: AppRevisionRecord,
  older?: AppRevisionRecord | null,
): AppRevisionDiffResult {
  if (!newer?.id) {
    return { ok: false, error: "newer revision is missing an id", warnings: [] };
  }

  const parseNewer = parseManifestSnapshot(
    newer.manifest_snapshot ?? newer.manifestSnapshot ?? null,
  );
  if (!parseNewer.ok) {
    return {
      ok: false,
      error: `failed to parse manifest for revision ${newer.id}: ${parseNewer.error}`,
      warnings: [],
    };
  }

  const olderParseResult = older
    ? parseManifestSnapshot(older.manifest_snapshot ?? older.manifestSnapshot ?? null)
    : { ok: true as const, manifest: emptyManifest, warnings: ["no previous revision; using empty baseline"] };

  if (!olderParseResult.ok) {
    return {
      ok: false,
      error: `failed to parse manifest for previous revision${older?.id ? ` ${older.id}` : ""}: ${olderParseResult.error}`,
      warnings: parseNewer.warnings,
    };
  }

  const warnings = [...parseNewer.warnings, ...olderParseResult.warnings];
  const newerSummary = summarizeRevision(newer);
  const olderSummary = older ? summarizeRevision(older) : null;

  const routesDiff = diffByKey(olderParseResult.manifest.routes, parseNewer.manifest.routes, getRouteKey);
  const screensDiff = diffByKey(olderParseResult.manifest.screens, parseNewer.manifest.screens, getScreenKey);
  const insertsDiff = diffByKey(olderParseResult.manifest.inserts, parseNewer.manifest.inserts, getInsertKey);
  const apDiff = diffByKey(olderParseResult.manifest.apHandlers, parseNewer.manifest.apHandlers, getApHandlerKey);
  const dataDiff = diffRecord(olderParseResult.manifest.dataCollections, parseNewer.manifest.dataCollections);
  const storageDiff = diffRecord(olderParseResult.manifest.storageBuckets, parseNewer.manifest.storageBuckets);

  const scriptNewer = normalizeId(newer.script_snapshot_ref ?? newer.scriptSnapshotRef);
  const scriptOlder = normalizeId(older?.script_snapshot_ref ?? older?.scriptSnapshotRef);
  const scriptChanged = (scriptNewer || "") !== (scriptOlder || "");

  const sectionTotals: Record<string, number> = {
    routes: countSectionDiff(routesDiff),
    views_screens: countSectionDiff(screensDiff),
    views_inserts: countSectionDiff(insertsDiff),
    ap_handlers: countSectionDiff(apDiff),
    data_collections: countSectionDiff(dataDiff),
    storage_buckets: countSectionDiff(storageDiff),
    script_snapshot_ref: scriptChanged ? 1 : 0,
  };

  const totalChanges = Object.values(sectionTotals).reduce((sum, value) => sum + value, 0);

  return {
    ok: true,
    diff: {
      newer: newerSummary,
      older: olderSummary,
      schema_versions: {
        newer: parseNewer.manifest.schemaVersion ?? newerSummary.schema_version,
        older: olderParseResult.manifest.schemaVersion ?? olderSummary?.schema_version ?? null,
      },
      script_snapshot: {
        newer: scriptNewer,
        older: scriptOlder,
        changed: scriptChanged,
      },
      sections: {
        routes: routesDiff,
        views: {
          screens: screensDiff,
          inserts: insertsDiff,
        },
        apHandlers: apDiff,
        dataCollections: dataDiff,
        storageBuckets: storageDiff,
      },
      summary: { totalChanges, sectionTotals },
      warnings,
    },
  };
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderJsonBlock = (value: unknown): string =>
  `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;

const renderDiffList = <T>(
  title: string,
  diff: SectionDiff<T>,
  formatLabel: (entry: DiffEntry<T>) => string,
): string => {
  const items = [...diff.added, ...diff.removed, ...diff.changed];
  if (items.length === 0) {
    return `<section class="card"><h3>${escapeHtml(title)}</h3><p class="muted">No changes</p></section>`;
  }

  const rows = items
    .map((entry) => {
      const label = formatLabel(entry);
      const body =
        entry.change === "changed"
          ? `<div class="diff-body">
              <div><div class="muted">Before</div>${renderJsonBlock(entry.before)}</div>
              <div><div class="muted">After</div>${renderJsonBlock(entry.after)}</div>
            </div>`
          : entry.after
            ? renderJsonBlock(entry.after)
            : entry.before
              ? renderJsonBlock(entry.before)
              : "";
      return `<li class="${entry.change}">
        <div class="item-header">
          <span class="badge ${entry.change}">${entry.change.toUpperCase()}</span>
          <span class="label">${escapeHtml(label)}</span>
        </div>
        ${body}
      </li>`;
    })
    .join("");

  return `<section class="card">
    <h3>${escapeHtml(title)}</h3>
    <ul class="changes">${rows}</ul>
  </section>`;
};

const formatRouteLabel = (entry: DiffEntry<AppRouteDefinition>): string => {
  const route = entry.after ?? entry.before;
  if (!route) return entry.id;
  const id = normalizeId((route as any).id);
  const method = normalizeId((route as any).method) ?? "GET";
  const path = normalizeId((route as any).path) ?? "";
  const parts = [id ? `#${id}` : null, path ? `${method} ${path}` : method];
  return parts.filter(Boolean).join(" · ") || entry.id;
};

const formatScreenLabel = (entry: DiffEntry<AppScreenDefinition>): string => {
  const screen = entry.after ?? entry.before;
  if (!screen) return entry.id;
  const id = normalizeId((screen as any).id);
  const title = normalizeId((screen as any).title);
  const parts = [id ? `#${id}` : null, title ?? null];
  return parts.filter(Boolean).join(" · ") || entry.id;
};

const formatInsertLabel = (entry: DiffEntry<AppViewInsertDefinition>): string => {
  const insert = entry.after ?? entry.before;
  if (!insert) return entry.id;
  const screen = normalizeId((insert as any).screen) ?? "unknown";
  const position = normalizeId((insert as any).position) ?? "root";
  const orderRaw = (insert as any).order;
  const order = Number.isFinite(orderRaw) ? Number(orderRaw) : 0;
  return `screen=${screen} · position=${position} · order=${order}`;
};

const formatApHandlerLabel = (entry: DiffEntry<AppApHandlerDefinition>): string => {
  const handler = entry.after ?? entry.before;
  if (!handler) return entry.id;
  const id = normalizeId((handler as any).id);
  const impl = normalizeId((handler as any).handler);
  const parts = [id ? `#${id}` : null, impl ?? null];
  return parts.filter(Boolean).join(" · ") || entry.id;
};

const formatCollectionLabel = (entry: DiffEntry<AppCollectionDefinition>): string =>
  entry.id || "collection";

const formatBucketLabel = (entry: DiffEntry<AppBucketDefinition>): string =>
  entry.id || "bucket";

export function renderAppRevisionDiffHtml(diff: AppRevisionDiffData): string {
  const sectionTotals = diff.summary.sectionTotals;
  const warningBlock =
    diff.warnings.length > 0
      ? `<div class="card warning"><strong>Warnings</strong><ul>${diff.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul></div>`
      : "";

  const summaryRows = Object.entries(sectionTotals)
    .map(
      ([key, value]) =>
        `<li><span class="label">${escapeHtml(key.replace(/_/g, " "))}</span><span class="value">${value}</span></li>`,
    )
    .join("");

  const newerLabel = `${escapeHtml(diff.newer.id)}${diff.newer.created_at ? ` · ${escapeHtml(diff.newer.created_at)}` : ""}`;
  const olderLabel = diff.older
    ? `${escapeHtml(diff.older.id)}${diff.older.created_at ? ` · ${escapeHtml(diff.older.created_at)}` : ""}`
    : "None (initial apply)";

  const scriptSummary = diff.script_snapshot.changed
    ? `<span class="badge changed">CHANGED</span> ${escapeHtml(diff.script_snapshot.older ?? "none")} → ${escapeHtml(diff.script_snapshot.newer ?? "none")}`
    : `<span class="badge neutral">UNCHANGED</span> ${escapeHtml(diff.script_snapshot.newer ?? "none")}`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>App Revision Diff</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: system-ui, -apple-system, sans-serif;
      }
      body { margin: 0; padding: 20px; background: #0f172a; color: #e2e8f0; }
      h1 { margin-top: 0; }
      .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
      .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.25); }
      .card h3 { margin-top: 0; }
      .summary { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
      .muted { color: #94a3b8; }
      ul { padding-left: 16px; }
      ul.changes { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
      ul.changes li { border: 1px solid #334155; border-radius: 10px; padding: 10px; background: #0b1220; }
      .item-header { display: flex; align-items: center; gap: 8px; }
      .badge { display: inline-block; padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 0.4px; }
      .badge.added { background: #0f766e; color: #ecfeff; }
      .badge.removed { background: #b91c1c; color: #fee2e2; }
      .badge.changed { background: #7c3aed; color: #ede9fe; }
      .badge.neutral { background: #475569; color: #e2e8f0; }
      li.added { border-color: #0f766e; }
      li.removed { border-color: #b91c1c; }
      li.changed { border-color: #7c3aed; }
      pre { background: #0f172a; padding: 10px; border-radius: 8px; overflow: auto; border: 1px solid #1e293b; }
      .diff-body { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      .warning { border-color: #b45309; background: #713f12; }
      .pill { display: inline-flex; gap: 6px; align-items: center; padding: 6px 10px; border-radius: 999px; background: #0b1220; border: 1px solid #334155; }
      .flex { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
      .summary ul { list-style: none; padding: 0; margin: 0; }
      .summary li { display: flex; justify-content: space-between; border-bottom: 1px dashed #334155; padding: 6px 0; }
    </style>
  </head>
  <body>
    <h1>App Revision Diff</h1>
    <div class="card summary">
      <div>
        <div class="muted">Newer</div>
        <div class="pill">${newerLabel}</div>
      </div>
      <div>
        <div class="muted">Previous</div>
        <div class="pill">${olderLabel}</div>
      </div>
      <div>
        <div class="muted">Script hash</div>
        <div>${scriptSummary}</div>
      </div>
      <div>
        <div class="muted">Schema version</div>
        <div>${escapeHtml(diff.schema_versions.older ?? "n/a")} → ${escapeHtml(diff.schema_versions.newer ?? "n/a")}</div>
      </div>
      <div>
        <div class="muted">Change counts</div>
        <ul>${summaryRows}</ul>
      </div>
    </div>
    ${warningBlock}
    <div class="grid">
      ${renderDiffList("Routes", diff.sections.routes, formatRouteLabel)}
      ${renderDiffList("Views · Screens", diff.sections.views.screens, formatScreenLabel)}
      ${renderDiffList("Views · Inserts", diff.sections.views.inserts, formatInsertLabel)}
      ${renderDiffList("AP Handlers", diff.sections.apHandlers, formatApHandlerLabel)}
      ${renderDiffList("Data Collections", diff.sections.dataCollections, formatCollectionLabel)}
      ${renderDiffList("Storage Buckets", diff.sections.storageBuckets, formatBucketLabel)}
    </div>
  </body>
</html>`;
}
