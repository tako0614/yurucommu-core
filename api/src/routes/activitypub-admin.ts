import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  TakosConfig,
  Variables,
} from "@takos/platform/server";
import {
  buildActivityPubPolicy,
  extractHostname,
  fail,
  ok,
} from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { buildRuntimeConfig, loadStoredConfig } from "../lib/config-utils";
import { guardAgentRequest } from "../lib/agent-guard";
import { persistConfigWithReloadGuard } from "../lib/config-reload";
import { enforceAgentConfigAllowlist, getAgentConfigAllowlist } from "../lib/agent-config-allowlist";
import { ErrorCodes } from "../lib/error-codes";

type ConfigSource = "stored" | "runtime";

type BlockSource = "config" | "env" | "config+env";

export type BlockedInstanceEntry = {
  domain: string;
  source: BlockSource;
  config: boolean;
  env: boolean;
};

function isAdminUser(user: any, env: Bindings): boolean {
  return !!env.AUTH_USERNAME && user?.id === env.AUTH_USERNAME;
}

export function normalizeBlockedInstance(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // First try to parse as URL with scheme prepended to handle "domain:port" correctly
  const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    const hostname = parsed.hostname.toLowerCase().replace(/^\*\./, "");
    if (hostname) return hostname;
  } catch {
    // Continue to fallback handling
  }
  // Fallback: use extractHostname for other cases (e.g., full ActivityPub URIs)
  const hostname = extractHostname(trimmed);
  let normalized = (hostname ?? trimmed).replace(/^\*\./, "").trim().toLowerCase();
  if (!normalized) return null;
  return normalized;
}

function normalizeBlockedList(list: string[] = []): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of list) {
    const value = normalizeBlockedInstance(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

export function mergeBlockedSources(
  configBlocked: string[],
  envBlocked: string[],
): BlockedInstanceEntry[] {
  const map = new Map<string, BlockedInstanceEntry>();

  for (const domain of envBlocked) {
    map.set(domain, { domain, source: "env", config: false, env: true });
  }

  for (const domain of configBlocked) {
    const existing = map.get(domain);
    if (existing) {
      existing.config = true;
      existing.source = existing.env ? "config+env" : "config";
    } else {
      map.set(domain, { domain, source: "config", config: true, env: false });
    }
  }

  return Array.from(map.values());
}

const dedupe = (list: string[]) => Array.from(new Set(list));

const getEnvBlockedInstances = (env: Bindings): string[] =>
  normalizeBlockedList(buildActivityPubPolicy({ env, config: null }).blocked);

async function resolveConfig(
  env: Bindings,
): Promise<{ config: TakosConfig; source: ConfigSource; configBlocked: string[] }> {
  const stored = await loadStoredConfig(env.DB);
  const source: ConfigSource = stored.config ? "stored" : "runtime";
  const config = stored.config ?? buildRuntimeConfig(env);
  const configBlocked = normalizeBlockedList(stored.config?.activitypub?.blocked_instances ?? []);
  return { config, source, configBlocked };
}

function applyBlockedInstances(config: TakosConfig, blocked: string[]): TakosConfig {
  const next: TakosConfig = {
    ...config,
    activitypub: {
      ...(config.activitypub ?? {}),
    },
  };

  if (blocked.length > 0) {
    next.activitypub!.blocked_instances = blocked;
  } else if (next.activitypub) {
    delete (next.activitypub as any).blocked_instances;
  }

  return next;
}

function buildBlockedPayload(
  env: Bindings,
  configBlocked: string[],
  source: ConfigSource,
): Record<string, unknown> {
  const envBlocked = getEnvBlockedInstances(env);
  const entries = mergeBlockedSources(configBlocked, envBlocked);
  const effective = dedupe([...configBlocked, ...envBlocked]);

  return {
    blocked_instances: entries,
    config_blocked_instances: configBlocked,
    env_blocked_instances: envBlocked,
    effective_blocked_instances: effective,
    source,
  };
}

const activityPubAdminRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const requireAdmin = async (c: any, next: any) => {
  const user = c.get("user") as any;
  if (!isAdminUser(user, c.env as Bindings)) {
    return fail(c, "Forbidden", 403, { code: ErrorCodes.FORBIDDEN });
  }
  await next();
};

activityPubAdminRoutes.use("/admin/activitypub/*", auth, requireAdmin);
activityPubAdminRoutes.use("/admin/federation/*", auth, requireAdmin);

const handleListBlocked = async (c: any) => {
  const { source, configBlocked } = await resolveConfig(c.env as Bindings);
  return ok(c, buildBlockedPayload(c.env as Bindings, configBlocked, source));
};

const handleAddBlocked = async (c: any) => {
  const agentGuard = guardAgentRequest(c.req, { toolId: "tool.updateTakosConfig" });
  if (!agentGuard.ok) {
    return fail(c, agentGuard.error, agentGuard.status);
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const domainInput =
    typeof body.domain === "string"
      ? body.domain
      : typeof body.hostname === "string"
        ? body.hostname
        : "";
  const normalized = normalizeBlockedInstance(domainInput);
  if (!normalized) {
    return fail(c, "domain is required", 400);
  }

  const { config, configBlocked } = await resolveConfig(c.env as Bindings);
  if (configBlocked.includes(normalized)) {
    return ok(c, {
      ...buildBlockedPayload(c.env as Bindings, configBlocked, "stored"),
      updated: false,
    });
  }

  if (agentGuard.agentType) {
    const allowlistCheck = enforceAgentConfigAllowlist({
      agentType: agentGuard.agentType,
      allowlist: getAgentConfigAllowlist(config),
      changedPaths: ["activitypub.blocked_instances"],
    });
    if (!allowlistCheck.ok) {
      return fail(c, allowlistCheck.error, allowlistCheck.status);
    }
  }

  const nextBlocked = [...configBlocked, normalized];
  const nextConfig = applyBlockedInstances(config, nextBlocked);
  const applyResult = await persistConfigWithReloadGuard({
    env: c.env as Bindings,
    nextConfig,
    previousConfig: config,
  });

  if (!applyResult.ok) {
    const reason = applyResult.reload.error || "config reload failed";
    const message = applyResult.rolledBack ? `${reason}; restored previous config` : reason;
    return fail(c, message, 500);
  }

  return ok(c, {
    ...buildBlockedPayload(c.env as Bindings, nextBlocked, "stored"),
    updated: true,
    reload: applyResult.reload,
  });
};

const handleDeleteBlocked = async (c: any) => {
  const agentGuard = guardAgentRequest(c.req, { toolId: "tool.updateTakosConfig" });
  if (!agentGuard.ok) {
    return fail(c, agentGuard.error, agentGuard.status);
  }

  const domainParam = c.req.param("domain") || "";
  const normalized = normalizeBlockedInstance(decodeURIComponent(domainParam));
  if (!normalized) {
    return fail(c, "domain is required", 400);
  }

  const envBlocked = getEnvBlockedInstances(c.env as Bindings);
  const { config, configBlocked } = await resolveConfig(c.env as Bindings);
  if (!configBlocked.includes(normalized)) {
    if (envBlocked.includes(normalized)) {
      return fail(c, "domain is blocked via environment and cannot be removed", 400);
    }
    return fail(c, "blocked instance not found", 404);
  }

  if (agentGuard.agentType) {
    const allowlistCheck = enforceAgentConfigAllowlist({
      agentType: agentGuard.agentType,
      allowlist: getAgentConfigAllowlist(config),
      changedPaths: ["activitypub.blocked_instances"],
    });
    if (!allowlistCheck.ok) {
      return fail(c, allowlistCheck.error, allowlistCheck.status);
    }
  }

  const nextBlocked = configBlocked.filter((item) => item !== normalized);
  const nextConfig = applyBlockedInstances(config, nextBlocked);
  const applyResult = await persistConfigWithReloadGuard({
    env: c.env as Bindings,
    nextConfig,
    previousConfig: config,
  });

  if (!applyResult.ok) {
    const reason = applyResult.reload.error || "config reload failed";
    const message = applyResult.rolledBack ? `${reason}; restored previous config` : reason;
    return fail(c, message, 500);
  }

  return ok(c, {
    ...buildBlockedPayload(c.env as Bindings, nextBlocked, "stored"),
    updated: true,
    still_blocked: envBlocked.includes(normalized),
    reload: applyResult.reload,
  });
};

activityPubAdminRoutes.get("/admin/activitypub/blocked-instances", handleListBlocked);
activityPubAdminRoutes.post("/admin/activitypub/blocked-instances", handleAddBlocked);
activityPubAdminRoutes.delete("/admin/activitypub/blocked-instances/:domain", handleDeleteBlocked);

// Alias endpoints: prefer federation naming from the Core control plane.
activityPubAdminRoutes.get("/admin/federation/blocked-instances", handleListBlocked);
activityPubAdminRoutes.post("/admin/federation/blocked-instances", handleAddBlocked);
activityPubAdminRoutes.delete("/admin/federation/blocked-instances/:domain", handleDeleteBlocked);

export default activityPubAdminRoutes;
