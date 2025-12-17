import defaultUiContract from "../../../schemas/ui-contract.json";
import {
  createInMemoryAppSource,
  loadAppManifest,
  parseUiContractJson,
  validateUiContractAgainstManifest,
  type AppManifestValidationIssue,
  type UiContract,
} from "@takos/platform/app";
import { ensureDefaultWorkspace, resolveWorkspaceEnv } from "./workspace-store";

const textDecoder = new TextDecoder();

const APP_HANDLERS_CANDIDATES = [
  "app/handlers.ts",
  "app/handlers.tsx",
  "app/handlers.js",
  "app/handlers.mjs",
  "app/handlers.cjs",
];

const UI_CONTRACT_FILENAME = "schemas/ui-contract.json";

const normalizeWorkspaceFilePath = (path: string): string => path.replace(/^\.?\/+/, "").trim();

const isArrayBufferLike = (value: unknown): value is ArrayBuffer =>
  value instanceof ArrayBuffer ||
  (!!value && typeof value === "object" && typeof (value as ArrayBuffer).byteLength === "number");

const normalizeWorkspaceFileContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (content instanceof Uint8Array) return textDecoder.decode(content);
  if (isArrayBufferLike(content)) return textDecoder.decode(new Uint8Array(content));
  return "";
};

const scanWorkspaceHandlers = (source: string): Set<string> => {
  const handlers = new Set<string>();
  const exportFunction = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g;
  const exportConst = /export\s+(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/g;
  const exportNamed = /export\s*{\s*([^}]+)\s*}/gs;
  const exportDefault = /export\s+default\s*{([^}]+)}/gs;

  for (const match of source.matchAll(exportFunction)) {
    if (match[1]) handlers.add(match[1]);
  }
  for (const match of source.matchAll(exportConst)) {
    if (match[1]) handlers.add(match[1]);
  }
  for (const match of source.matchAll(exportNamed)) {
    const names = match[1].split(",").map((part) => part.trim().split(/\s+as\s+/i)[0]);
    names.filter(Boolean).forEach((name) => handlers.add(name));
  }
  for (const match of source.matchAll(exportDefault)) {
    const objectBody = match[1];
    const props = objectBody
      .split(",")
      .map((chunk) => chunk.trim().split(":")[0]?.split(/\s+as\s+/i)[0])
      .filter(Boolean);
    props.forEach((name) => handlers.add(name));
  }

  return handlers;
};

const detectWorkspaceHandlers = (
  files: Record<string, string>,
): { handlers: Set<string> | null; issues: AppManifestValidationIssue[] } => {
  for (const candidate of APP_HANDLERS_CANDIDATES) {
    const content = files[candidate];
    if (typeof content !== "string") continue;
    try {
      return { handlers: scanWorkspaceHandlers(content), issues: [] };
    } catch (error) {
      return {
        handlers: null,
        issues: [
          {
            severity: "warning",
            message: `failed to parse ${candidate}: ${(error as Error).message}`,
            file: candidate,
          },
        ],
      };
    }
  }
  return { handlers: null, issues: [] };
};

const loadUiContractFromWorkspace = (
  files: Record<string, string>,
): { contract: UiContract | null; issues: AppManifestValidationIssue[] } => {
  const raw = files[UI_CONTRACT_FILENAME];
  if (typeof raw !== "string") {
    return { contract: null, issues: [] };
  }
  const parsed = parseUiContractJson(raw, UI_CONTRACT_FILENAME);
  return { contract: parsed.contract ?? null, issues: parsed.issues };
};

export const validateWorkspaceManifest = async (
  workspaceId: string,
  env: any,
): Promise<{ ok: boolean; issues: AppManifestValidationIssue[]; status: number }> => {
  const issues: AppManifestValidationIssue[] = [];
  const { store, isolation } = resolveWorkspaceEnv({
    env,
    mode: "dev",
    requireIsolation: true,
  });
  if (isolation?.required && !isolation.ok) {
    return {
      ok: false,
      issues: [
        {
          severity: "error",
          message: isolation.errors[0] || "dev data isolation failed",
        },
      ],
      status: 503,
    };
  }
  if (!store?.listWorkspaceFiles) {
    return {
      ok: false,
      issues: [{ severity: "error", message: "workspace store is not configured" }],
      status: 500,
    };
  }

  let files: any[] = [];
  try {
    await ensureDefaultWorkspace(store);
    files = await store.listWorkspaceFiles(workspaceId);
  } catch (error) {
    return {
      ok: false,
      issues: [{ severity: "error", message: `failed to load workspace files: ${(error as Error).message}` }],
      status: 500,
    };
  }

  if (!files || files.length === 0) {
    return {
      ok: false,
      issues: [{ severity: "error", message: "workspace files not found" }],
      status: 404,
    };
  }

  const fileMap: Record<string, string> = {};
  for (const file of files) {
    const path = normalizeWorkspaceFilePath(file?.path ?? "");
    if (!path) continue;
    fileMap[path] = normalizeWorkspaceFileContent(file?.content);
  }

  if (!fileMap["manifest.json"] && fileMap["takos-app.json"]) {
    fileMap["manifest.json"] = fileMap["takos-app.json"];
  }

  const handlerInfo = detectWorkspaceHandlers(fileMap);
  issues.push(...handlerInfo.issues);

  const uiContract = loadUiContractFromWorkspace(fileMap);
  issues.push(...uiContract.issues);
  const resolvedContract: UiContract = uiContract.contract ?? (defaultUiContract as UiContract);
  if (!uiContract.contract) {
    issues.push({
      severity: "warning",
      message: `${UI_CONTRACT_FILENAME} not found in workspace; using default contract`,
      file: UI_CONTRACT_FILENAME,
    });
  }

  try {
    const result = await loadAppManifest({
      source: createInMemoryAppSource(fileMap),
      availableHandlers: handlerInfo.handlers ?? undefined,
    });
    issues.push(...result.issues);

    if (result.manifest) {
      issues.push(
        ...validateUiContractAgainstManifest(
          result.manifest,
          resolvedContract,
          uiContract.contract ? UI_CONTRACT_FILENAME : undefined,
        ),
      );
    }

    const hasErrors = issues.some((issue) => issue.severity === "error");
    return {
      ok: Boolean(result.manifest) && !hasErrors,
      issues,
      status: hasErrors ? 400 : 200,
    };
  } catch (error) {
    return {
      ok: false,
      issues: [
        ...issues,
        { severity: "error", message: `workspace validation failed: ${(error as Error).message}` },
      ],
      status: 500,
    };
  }
};

