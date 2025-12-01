// Utility functions for building UI screen previews from App Manifest views.

export type UiNode = {
  type: string;
  id?: string;
  props?: Record<string, any>;
  children?: UiNode[];
};

export type ViewScreen = {
  id: string;
  route?: string;
  title?: string;
  layout: UiNode;
};

export type ViewInsert = {
  screen: string;
  position?: string;
  order?: number;
  node: UiNode;
};

export type AppViews = {
  screens?: ViewScreen[];
  insert?: ViewInsert[];
};

export type AppWorkspaceManifest = {
  id?: string;
  name?: string;
  views: AppViews;
};

export type JsonPatchOperation = {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
};

export type ScreenPreviewResult = {
  screenId: string;
  resolvedTree: UiNode;
  warnings: string[];
};

export type PreviewMode = "prod" | "dev";

export class AppPreviewError extends Error {
  code:
    | "workspace_not_found"
    | "screen_not_found"
    | "invalid_manifest"
    | "unsupported_view_mode"
    | "invalid_request";

  constructor(
    code:
      | "workspace_not_found"
      | "screen_not_found"
      | "invalid_manifest"
      | "unsupported_view_mode"
      | "invalid_request",
    message: string,
  ) {
    super(message);
    this.name = "AppPreviewError";
    this.code = code;
  }
}

const cloneNode = (node: UiNode): UiNode => ({
  ...node,
  props: node.props ? { ...node.props } : undefined,
  children: node.children ? node.children.map(cloneNode) : undefined,
});

const matchPosition = (node: UiNode, position: string): boolean => {
  if (!position) return false;
  const props = node.props || {};
  return (
    node.id === position ||
    props.id === position ||
    props.slot === position ||
    props.position === position ||
    props.region === position
  );
};

const findTargets = (root: UiNode, position?: string): UiNode[] => {
  if (!position) return [root];
  const matches: UiNode[] = [];

  const walk = (node: UiNode) => {
    if (matchPosition(node, position)) {
      matches.push(node);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  };

  walk(root);
  return matches;
};

const normalizeInserts = (views?: AppViews): ViewInsert[] =>
  Array.isArray(views?.insert)
    ? [...views.insert].filter((i) => i && typeof i.screen === "string")
    : [];

/**
 * Resolve a screen layout into a final UiNode tree by applying inserts.
 * Returns a deep-cloned tree so the input manifest is never mutated.
 */
export function resolveScreenPreview(
  manifest: AppWorkspaceManifest,
  screenId: string,
): ScreenPreviewResult {
  if (!manifest || !manifest.views) {
    throw new AppPreviewError("invalid_manifest", "App views are missing");
  }

  const screens = Array.isArray(manifest.views.screens)
    ? manifest.views.screens
    : [];
  const screen = screens.find((s) => s.id === screenId);
  if (!screen) {
    throw new AppPreviewError("screen_not_found", `Screen not found: ${screenId}`);
  }
  if (!screen.layout) {
    throw new AppPreviewError("invalid_manifest", "Screen layout is missing");
  }

  const baseTree = cloneNode(screen.layout);
  const inserts = normalizeInserts(manifest.views)
    .filter((i) => i.screen === screenId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const warnings: string[] = [];

  for (const insert of inserts) {
    const targets = findTargets(baseTree, insert.position);
    if (targets.length === 0) {
      warnings.push(
        `insert_skipped: position "${insert.position || "root"}" not found in layout`,
      );
      continue;
    }
    for (const target of targets) {
      const nextNode = cloneNode(insert.node);
      const children = Array.isArray(target.children) ? target.children : [];
      target.children = [...children, nextNode];
    }
  }

  return {
    screenId: screen.id,
    resolvedTree: baseTree,
    warnings,
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const cloneValue = <T>(value: T): T => {
  const structuredCloneFn = (globalThis as any).structuredClone;
  if (typeof structuredCloneFn === "function") {
    return structuredCloneFn(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const parsePointer = (path: string): string[] => {
  if (path === "") return [];
  if (!path.startsWith("/")) {
    throw new AppPreviewError("invalid_request", `patch path must start with "/" (${path})`);
  }
  const segments = path
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (segments.some((segment) => segment.length === 0)) {
    throw new AppPreviewError("invalid_request", `patch path "${path}" contains empty segments`);
  }
  return segments;
};

const parseArrayIndex = (segment: string, allowAppend: boolean, length: number, path: string) => {
  if (segment === "-") {
    if (allowAppend) {
      return length;
    }
    throw new AppPreviewError("invalid_request", `"-" is only allowed for add operations (${path})`);
  }
  const index = Number(segment);
  if (!Number.isInteger(index) || index < 0) {
    throw new AppPreviewError("invalid_request", `invalid array index "${segment}" in ${path}`);
  }
  return index;
};

const getContainer = (root: any, segments: string[], fullPath: string) => {
  let current = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (Array.isArray(current)) {
      const index = parseArrayIndex(segment, false, current.length, fullPath);
      if (index >= current.length) {
        throw new AppPreviewError("invalid_request", `path not found at "${fullPath}"`);
      }
      current = current[index];
      continue;
    }
    if (isPlainObject(current)) {
      if (!(segment in current)) {
        throw new AppPreviewError("invalid_request", `path not found at "${fullPath}"`);
      }
      current = (current as any)[segment];
      continue;
    }
    throw new AppPreviewError("invalid_request", `cannot traverse path "${fullPath}"`);
  }
  return { parent: current, key: segments[segments.length - 1] };
};

const hasValue = (patch: JsonPatchOperation) =>
  Object.prototype.hasOwnProperty.call(patch, "value");

const applyOperation = (document: any, patch: JsonPatchOperation): any => {
  const fullPath = patch.path;
  if ((patch.op === "add" || patch.op === "replace") && !hasValue(patch)) {
    throw new AppPreviewError("invalid_request", `${patch.op} operation requires a value`);
  }

  const segments = parsePointer(fullPath);
  if (segments.length === 0) {
    if (patch.op === "remove") {
      throw new AppPreviewError("invalid_request", "cannot remove the document root");
    }
    return cloneValue(patch.value) as any;
  }

  const { parent, key } = getContainer(document, segments, fullPath);

  if (Array.isArray(parent)) {
    const index = parseArrayIndex(key, patch.op === "add", parent.length, fullPath);
    if (patch.op === "add") {
      if (index > parent.length) {
        throw new AppPreviewError("invalid_request", `index out of range for add at "${fullPath}"`);
      }
      parent.splice(index, 0, cloneValue(patch.value));
      return document;
    }
    if (index >= parent.length) {
      throw new AppPreviewError("invalid_request", `path not found at "${fullPath}"`);
    }
    if (patch.op === "replace") {
      parent[index] = cloneValue(patch.value);
      return document;
    }
    parent.splice(index, 1);
    return document;
  }

  if (isPlainObject(parent)) {
    if (patch.op === "add") {
      (parent as any)[key] = cloneValue(patch.value);
      return document;
    }
    if (!(key in parent)) {
      throw new AppPreviewError("invalid_request", `path not found at "${fullPath}"`);
    }
    if (patch.op === "replace") {
      (parent as any)[key] = cloneValue(patch.value);
      return document;
    }
    delete (parent as any)[key];
    return document;
  }

  throw new AppPreviewError("invalid_request", `cannot apply patch at "${fullPath}"`);
};

export function applyJsonPatches<T>(input: T, patches: JsonPatchOperation[]): T {
  let document: any = cloneValue(input);
  for (let i = 0; i < patches.length; i++) {
    try {
      document = applyOperation(document, patches[i]);
    } catch (error) {
      if (error instanceof AppPreviewError) {
        throw new AppPreviewError(error.code, `patch[${i}]: ${error.message}`);
      }
      throw error;
    }
  }
  return document as T;
}

export function normalizeJsonPatchOperations(raw: unknown): JsonPatchOperation[] {
  if (!Array.isArray(raw)) {
    throw new AppPreviewError("invalid_request", "patches must be an array");
  }

  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new AppPreviewError("invalid_request", `patch[${index}] must be an object`);
    }
    const opRaw = (entry as any).op;
    const op = typeof opRaw === "string" ? opRaw.trim().toLowerCase() : "";
    if (op !== "add" && op !== "replace" && op !== "remove") {
      throw new AppPreviewError("invalid_request", `unsupported op for patch[${index}]`);
    }
    const path = typeof (entry as any).path === "string" ? (entry as any).path : "";
    if (!path) {
      throw new AppPreviewError("invalid_request", `path is required for patch[${index}]`);
    }
    const hasValueField = Object.prototype.hasOwnProperty.call(entry, "value");
    if ((op === "add" || op === "replace") && !hasValueField) {
      throw new AppPreviewError("invalid_request", `value is required for patch[${index}]`);
    }

    return {
      op,
      path,
      value: hasValueField ? (entry as any).value : undefined,
    } as JsonPatchOperation;
  });
}
