/// <reference types="@cloudflare/workers-types" />

import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { fail, ok } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { requireHumanSession, requireWorkspacePlan } from "../lib/workspace-guard";
import { ensureDefaultWorkspace, resolveWorkspaceEnv } from "../lib/workspace-store";
import { validateWorkspaceManifest } from "../lib/app-workspace-validation";

const VALIDATION_CACHE_KEY_PREFIX = "dev-validate:";

const resolveValidationTtlSeconds = (env: any): number => {
  const raw = env?.TAKOS_VALIDATE_CACHE_TTL_SECONDS;
  const ttl = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : 300;
  if (!Number.isFinite(ttl)) return 300;
  return Math.max(0, Math.trunc(ttl));
};

const appValidate = new Hono<{ Bindings: Bindings; Variables: Variables }>();

appValidate.use("/-/dev/validate/*", auth, requireHumanSession, requireWorkspacePlan);
appValidate.use("/-/dev/validate", auth, requireHumanSession, requireWorkspacePlan);

appValidate.post("/-/dev/validate/:id", async (c) => {
  const workspaceId = (c.req.param("id") || "").trim();
  if (!workspaceId) return fail(c as any, "workspaceId is required", 400);

  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env,
    mode: "dev",
    requireIsolation: true,
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return fail(c as any, workspaceEnv.isolation.errors[0] || "dev data isolation failed", 503);
  }
  const store = workspaceEnv.store;
  if (!store) return fail(c as any, "workspace store is not configured", 503);
  await ensureDefaultWorkspace(store);

  const workspace = await store.getWorkspace(workspaceId);
  if (!workspace) return fail(c as any, "workspace not found", 404);

  const validatedAt = new Date().toISOString();
  const validation = await validateWorkspaceManifest(workspaceId, workspaceEnv.env);
  const status = validation.ok ? 200 : validation.status;

  const kv = (workspaceEnv.env as any)?.KV as KVNamespace | undefined;
  if (kv) {
    const ttl = resolveValidationTtlSeconds(workspaceEnv.env);
    const key = `${VALIDATION_CACHE_KEY_PREFIX}${workspaceId}`;
    await kv
      .put(
        key,
        JSON.stringify({
          workspace_id: workspaceId,
          validated_at: validatedAt,
          ok: validation.ok,
          status,
          issues: validation.issues,
        }),
        ttl > 0 ? { expirationTtl: ttl } : undefined,
      )
      .catch(() => null);
  }

  return c.json(
    {
      ok: validation.ok,
      workspace: { id: workspace.id, status: workspace.status },
      issues: validation.issues,
      status,
      validated_at: validatedAt,
    },
    status as any,
  );
});

appValidate.get("/-/dev/validate/:id/status", async (c) => {
  const workspaceId = (c.req.param("id") || "").trim();
  if (!workspaceId) return fail(c as any, "workspaceId is required", 400);

  const kv = ((c.env as any)?.KV ?? (c.env as any)?.DEV_KV) as KVNamespace | undefined;
  if (!kv) {
    return c.json({ ok: true, workspace_id: workspaceId, validated_at: null, status: "not_validated" });
  }

  const key = `${VALIDATION_CACHE_KEY_PREFIX}${workspaceId}`;
  const cached = await kv.get(key, "json").catch(() => null);
  if (!cached || typeof cached !== "object") {
    return c.json({ ok: true, workspace_id: workspaceId, validated_at: null, status: "not_validated" });
  }

  return ok(c as any, cached);
});

export default appValidate;
