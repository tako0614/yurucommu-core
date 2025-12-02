import type { AgentType } from "@takos/platform/server";
import type { ConfigDiffEntry } from "./config-utils";

type ConfigLike = {
  ai?: { agent_config_allowlist?: unknown };
};

const normalizeAllowlist = (value?: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item : String(item ?? "")))
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
};

const isPathAllowed = (path: string, allowlist: string[]): boolean => {
  if (!path) return false;
  for (const allowed of allowlist) {
    if (allowed === "*") return true;
    if (path === allowed) return true;
    if (path === "$" && (allowed === "$" || allowed === "*")) return true;
    if (path.startsWith(`${allowed}.`) || path.startsWith(`${allowed}[`)) {
      return true;
    }
  }
  return false;
};

export function getAgentConfigAllowlist(config: ConfigLike): string[] {
  return normalizeAllowlist(config?.ai?.agent_config_allowlist);
}

export function changedPathsFromDiff(diff: ConfigDiffEntry[]): string[] {
  return diff.map((entry) => entry.path);
}

export function findDisallowedConfigPaths(
  paths: Iterable<string>,
  allowlist: string[],
): string[] {
  const normalizedAllowlist = normalizeAllowlist(allowlist);
  const disallowed = new Set<string>();
  for (const path of paths) {
    if (!path) continue;
    if (!isPathAllowed(path, normalizedAllowlist)) {
      disallowed.add(path);
    }
  }
  return Array.from(disallowed.values());
}

export function enforceAgentConfigAllowlist(params: {
  agentType: AgentType | null;
  allowlist: string[];
  changedPaths: Iterable<string>;
}): { ok: true } | { ok: false; status: number; error: string; disallowed: string[] } {
  if (!params.agentType) {
    return { ok: true };
  }

  const disallowed = findDisallowedConfigPaths(params.changedPaths, params.allowlist);
  if (disallowed.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 403,
    error: `agent cannot modify config paths: ${disallowed.join(", ")}`,
    disallowed,
  };
}
