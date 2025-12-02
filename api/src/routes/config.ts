import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  TakosConfig,
  Variables,
} from "@takos/platform/server";
import { ok, fail, validateTakosConfig } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import {
  buildRuntimeConfig,
  checkDistroCompatibility,
  diffConfigs,
  loadStoredConfig,
  stripSecretsFromConfig,
} from "../lib/config-utils";
import { assertConfigAiActionsAllowed } from "../lib/ai-action-allowlist";
import { guardAgentRequest } from "../lib/agent-guard";
import { listConfigAudit, recordConfigAudit } from "../lib/config-audit";
import { persistConfigWithReloadGuard } from "../lib/config-reload";
import {
  changedPathsFromDiff,
  enforceAgentConfigAllowlist,
  getAgentConfigAllowlist,
} from "../lib/agent-config-allowlist";

const configRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

type ConfigActor = {
  user: any;
};

const getSessionUser = (c: any) =>
  (c.get("sessionUser") as any) || (c.get("user") as any) || null;

const resolveActorHandle = (actor: ConfigActor | null) =>
  actor?.user?.handle ?? actor?.user?.id ?? null;

/** Require any authenticated user */
const requireAuthenticatedUser = (c: any): ConfigActor | null => {
  const sessionUser = getSessionUser(c);
  if (!sessionUser?.id) {
    return null;
  }
  return { user: sessionUser };
};

type ActiveConfig = {
  config: TakosConfig;
  source: "stored" | "runtime";
  warnings: string[];
  strippedFields: string[];
};

type SanitizedConfig = {
  config: TakosConfig;
  warnings: string[];
  strippedFields: string[];
};

function sanitizeConfig(config: TakosConfig): SanitizedConfig {
  const strippedFields: string[] = [];
  const sanitized = stripSecretsFromConfig(config, strippedFields);
  const warnings = strippedFields.length
    ? [`stripped secret fields: ${strippedFields.join(", ")}`]
    : [];
  return { config: sanitized, warnings, strippedFields };
}

async function loadActiveConfig(env: Bindings): Promise<ActiveConfig> {
  const warnings: string[] = [];
  const stored = await loadStoredConfig(env.DB);
  if (stored.warnings.length) {
    warnings.push(...stored.warnings);
  }

  const baseConfig = stored.config ?? buildRuntimeConfig(env);
  assertConfigAiActionsAllowed(baseConfig);
  const sanitized = sanitizeConfig(baseConfig);
  warnings.push(...sanitized.warnings);

  return {
    config: sanitized.config,
    source: stored.config ? "stored" : "runtime",
    warnings,
    strippedFields: sanitized.strippedFields,
  };
}

async function handleConfigExport(c: any) {
  const activeConfig = await loadActiveConfig(c.env as Bindings);

  return ok(c, {
    config: activeConfig.config,
    distro: activeConfig.config.distro,
    schema_version: activeConfig.config.schema_version,
    source: activeConfig.source,
    warnings: activeConfig.warnings,
  });
}

configRoutes.get("/admin/config/export", auth, async (c) => {
  const actor = requireAuthenticatedUser(c);
  if (!actor) {
    return fail(c, "authentication required", 403);
  }
  return handleConfigExport(c);
});

configRoutes.get("/-/config/export", auth, async (c) => {
  const actor = requireAuthenticatedUser(c);
  if (!actor) {
    return fail(c, "authentication required", 403);
  }
  return handleConfigExport(c);
});

configRoutes.get("/admin/config/audit", auth, async (c) => {
  const actor = requireAuthenticatedUser(c);
  if (!actor) {
    return fail(c, "authentication required", 403);
  }

  const limitParam = c.req.query("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const entries = await listConfigAudit((c.env as Bindings).DB, { limit });

  return ok(c, { entries });
});

async function handleConfigDiff(c: any) {
  const force = c.req.query("force") === "true";
  const agentGuard = guardAgentRequest(c.req, { toolId: "tool.updateTakosConfig" });
  if (!agentGuard.ok) {
    return fail(c, agentGuard.error, agentGuard.status);
  }

  const body = (await c.req.json().catch(() => null)) as any;
  if (!body || typeof body !== "object") {
    return fail(c, "invalid config payload", 400);
  }

  const validation = validateTakosConfig(body);
  if (!validation.ok || !validation.config) {
    const message = validation.errors?.length ? validation.errors.join("; ") : "invalid config";
    return fail(c, message, 400);
  }

  const activeConfig = await loadActiveConfig(c.env as Bindings);
  const compatibility = checkDistroCompatibility(
    activeConfig.config.distro,
    validation.config.distro,
    force,
  );

  if (!compatibility.ok) {
    return fail(c, compatibility.error || "config incompatible with this distro", 409);
  }

  try {
    assertConfigAiActionsAllowed(validation.config);
  } catch (error: any) {
    return fail(c, error?.message || "invalid AI action allowlist", 400);
  }

  const incoming = sanitizeConfig(validation.config);
  const diff = diffConfigs(activeConfig.config, incoming.config);
  if (agentGuard.agentType) {
    const allowlistCheck = enforceAgentConfigAllowlist({
      agentType: agentGuard.agentType,
      allowlist: getAgentConfigAllowlist(activeConfig.config),
      changedPaths: changedPathsFromDiff(diff),
    });
    if (!allowlistCheck.ok) {
      return fail(c, allowlistCheck.error, allowlistCheck.status);
    }
  }
  const warnings = [
    ...activeConfig.warnings,
    ...compatibility.warnings,
    ...incoming.warnings,
  ];

  return ok(c, {
    diff,
    diff_count: diff.length,
    current: activeConfig.config,
    incoming: incoming.config,
    source: activeConfig.source,
    warnings,
  });
}

async function handleConfigImport(c: any, actor: ConfigActor) {
  const force = c.req.query("force") === "true";
  const agentGuard = guardAgentRequest(c.req, { toolId: "tool.updateTakosConfig" });
  if (!agentGuard.ok) {
    return fail(c, agentGuard.error, agentGuard.status);
  }
  const body = (await c.req.json().catch(() => null)) as any;
  if (!body || typeof body !== "object") {
    return fail(c, "invalid config payload", 400);
  }

  const validation = validateTakosConfig(body);
  if (!validation.ok || !validation.config) {
    const message = validation.errors?.length ? validation.errors.join("; ") : "invalid config";
    return fail(c, message, 400);
  }

  const activeConfig = await loadActiveConfig(c.env as Bindings);
  const compatibility = checkDistroCompatibility(
    activeConfig.config.distro,
    validation.config.distro,
    force,
  );

  if (!compatibility.ok) {
    return fail(c, compatibility.error || "config incompatible with this distro", 409);
  }

  try {
    assertConfigAiActionsAllowed(validation.config);
  } catch (error: any) {
    return fail(c, error?.message || "invalid AI action allowlist", 400);
  }

  const incoming = sanitizeConfig(validation.config);
  const diff = diffConfigs(activeConfig.config, incoming.config);
  if (agentGuard.agentType) {
    const allowlistCheck = enforceAgentConfigAllowlist({
      agentType: agentGuard.agentType,
      allowlist: getAgentConfigAllowlist(activeConfig.config),
      changedPaths: changedPathsFromDiff(diff),
    });
    if (!allowlistCheck.ok) {
      return fail(c, allowlistCheck.error, allowlistCheck.status);
    }
  }

  const warnings = [...compatibility.warnings, ...incoming.warnings];

  const applyResult = await persistConfigWithReloadGuard({
    env: c.env as Bindings,
    nextConfig: incoming.config,
    previousConfig: activeConfig.config,
  });
  await recordConfigAudit((c.env as Bindings).DB, {
    action: "config_import",
    actorId: actor?.user?.id ?? null,
    actorHandle: resolveActorHandle(actor),
    agentType: agentGuard.agentType ?? null,
    details: {
      source: activeConfig.source,
      force,
      distro: incoming.config.distro,
      schema_version: incoming.config.schema_version,
      warnings: [...warnings, ...(applyResult.reload.warnings || [])],
      reload_ok: applyResult.reload.ok,
      reload_error: applyResult.reload.error ?? null,
      reload_source: applyResult.reload.source ?? null,
      reload_reloaded: applyResult.reload.reloaded ?? null,
      rolled_back: applyResult.rolledBack,
      stripped_fields: incoming.strippedFields,
      previous_stripped_fields: activeConfig.strippedFields,
      previous_config: activeConfig.config,
      next_config: incoming.config,
    },
  });

  if (!applyResult.ok) {
    const reason = applyResult.reload.error || "config reload failed";
    return fail(
      c,
      `${reason}; restored previous config`,
      500,
    );
  }

  return ok(c, {
    config: incoming.config,
    warnings: [...warnings, ...(applyResult.reload.warnings || [])],
    reload: applyResult.reload,
  });
}

configRoutes.post("/admin/config/diff", auth, async (c) => {
  const actor = requireAuthenticatedUser(c);
  if (!actor) {
    return fail(c, "authentication required", 403);
  }
  return handleConfigDiff(c);
});

configRoutes.post("/-/config/diff", auth, async (c) => {
  const actor = requireAuthenticatedUser(c);
  if (!actor) {
    return fail(c, "authentication required", 403);
  }
  return handleConfigDiff(c);
});

configRoutes.post("/admin/config/import", auth, async (c) => {
  const actor = requireAuthenticatedUser(c);
  if (!actor) {
    return fail(c, "authentication required", 403);
  }
  return handleConfigImport(c, actor);
});

configRoutes.post("/-/config/import", auth, async (c) => {
  const actor = requireAuthenticatedUser(c);
  if (!actor) {
    return fail(c, "authentication required", 403);
  }
  return handleConfigImport(c, actor);
});

export default configRoutes;
