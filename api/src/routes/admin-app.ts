import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import {
  APP_MANIFEST_SCHEMA_VERSION,
  checkSemverCompatibility,
  fail,
  nowISO,
  ok,
  releaseStore,
  validateAppSchemaVersion,
} from "@takos/platform/server";
import { makeData } from "../data";
import { guardAgentRequest } from "../lib/agent-guard";
import { buildAppRevisionDiff, renderAppRevisionDiffHtml } from "../lib/app-revision-diff";

type AdminAuthResult =
  | { ok: true; admin: string }
  | { ok: false; status: number; message: string };

function decodeBasicAuth(encoded: string): string | null {
  try {
    if (typeof atob === "function") {
      return atob(encoded);
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.from(encoded, "base64").toString("utf-8");
    }
  } catch {
    // fall through
  }
  return null;
}

function checkAdminAuth(c: any): AdminAuthResult {
  const username = c.env.AUTH_USERNAME?.trim();
  const password = c.env.AUTH_PASSWORD?.trim();
  if (!username || !password) {
    return { ok: false, status: 500, message: "admin credentials are not configured" };
  }
  const header = c.req.header("Authorization") || "";
  if (!header.startsWith("Basic ")) {
    return { ok: false, status: 401, message: "admin basic auth required" };
  }
  const encoded = header.slice("Basic ".length).trim();
  const decoded = decodeBasicAuth(encoded);
  if (!decoded || !decoded.includes(":")) {
    return { ok: false, status: 401, message: "invalid authorization header" };
  }
  const [user, ...rest] = decoded.split(":");
  const pass = rest.join(":");
  if (user !== username || pass !== password) {
    return { ok: false, status: 401, message: "invalid credentials" };
  }
  return { ok: true, admin: user };
}

const adminAppRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

adminAppRoutes.use("/admin/app/*", async (c, next) => {
  const auth = checkAdminAuth(c);
  if (!auth.ok) {
    if (auth.status === 401) {
      c.header("WWW-Authenticate", 'Basic realm="takos-admin"');
    }
    return fail(c as any, auth.message, auth.status);
  }
  (c as any).set("adminUser", auth.admin);
  await next();
});

adminAppRoutes.get("/admin/app/revisions", async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const limit = Math.min(
      100,
      Math.max(
        1,
        Number.parseInt(String(c.req.query("limit") ?? ""), 10) || 20,
      ),
    );
    const [state, revisions] = await Promise.all([
      store.getActiveAppRevision(),
      store.listAppRevisions(limit),
    ]);
    return ok(c as any, {
      active_revision_id: state?.active_revision_id ?? null,
      state,
      revisions,
    });
  } finally {
    await releaseStore(store);
  }
});

adminAppRoutes.get("/admin/app/revisions/diff", async (c) => {
  const store = makeData(c.env as any, c);
  try {
    if (!store.listAppRevisions) {
      return fail(c as any, "app revisions are not supported", 501);
    }
    const revisions = await store.listAppRevisions(2);
    if (!revisions || revisions.length === 0) {
      return fail(c as any, "no app revisions found", 404);
    }
    const newer = revisions[0];
    const older = revisions[1] ?? null;

    const diff = buildAppRevisionDiff(newer, older);
    if (!diff.ok) {
      return fail(c as any, diff.error, 500);
    }

    const format = (c.req.query("format") || "").trim().toLowerCase();
    const wantsHtml =
      format === "html" || (c.req.header("accept") || "").toLowerCase().includes("text/html");

    if (wantsHtml) {
      return c.html(renderAppRevisionDiffHtml(diff.diff));
    }

    return ok(c as any, diff.diff);
  } catch (error) {
    console.error("failed to compute app revision diff", error);
    return fail(c as any, "failed to compute app revision diff", 500);
  } finally {
    await releaseStore(store);
  }
});

adminAppRoutes.post("/admin/app/revisions/apply", async (c) => {
  const agentGuard = guardAgentRequest(c.req, { forbidAgents: true });
  if (!agentGuard.ok) {
    return fail(c as any, agentGuard.error, agentGuard.status);
  }
  const store = makeData(c.env as any, c);
  try {
    if (
      !store.createAppRevision ||
      !store.setActiveAppRevision ||
      !store.getActiveAppRevision ||
      !store.getAppRevision
    ) {
      return fail(c as any, "app revisions are not supported", 501);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    const rawManifest = body.manifest;
    let manifest = rawManifest;
    if (typeof rawManifest === "string") {
      try {
        manifest = JSON.parse(rawManifest);
      } catch {
        return fail(c as any, "manifest must be valid JSON", 400);
      }
    }
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      return fail(c as any, "manifest must be an object", 400);
    }
    const schemaValidation = validateAppSchemaVersion(manifest);
    if (!schemaValidation.ok || !schemaValidation.version) {
      return fail(
        c as any,
        schemaValidation.error || "unsupported app schema_version",
        400,
      );
    }
    const schemaVersion = schemaValidation.version;
    const warnings = [...(schemaValidation.warnings ?? [])];
    const scriptRef =
      typeof body.scriptRef === "string" && body.scriptRef.trim().length > 0
        ? body.scriptRef.trim()
        : "";
    if (!scriptRef) {
      return fail(c as any, "scriptRef is required", 400);
    }
    const requestedId =
      typeof body.revisionId === "string" && body.revisionId.trim().length > 0
        ? body.revisionId.trim()
        : "";
    if (requestedId) {
      const exists = await store.getAppRevision(requestedId);
      if (exists) {
        return fail(c as any, "revision already exists", 409);
      }
    }
    const author = (body.author ?? {}) as Record<string, any>;
    if (author.type === "agent") {
      return fail(c as any, "AI agents cannot apply app revisions", 403);
    }
    const authorType = author.type === "agent" ? "agent" : "human";
    const authorName =
      typeof author.name === "string" && author.name.trim().length > 0
        ? author.name.trim()
        : (c as any).get("adminUser");
    const saved = await store.createAppRevision({
      id: requestedId || undefined,
      schema_version: schemaVersion,
      manifest_snapshot: JSON.stringify(manifest),
      script_snapshot_ref: scriptRef,
      message:
        typeof body.message === "string" && body.message.trim().length > 0
          ? body.message.trim()
          : null,
      author_type: authorType,
      author_name: authorName ?? null,
      created_at: nowISO(),
    });
    if (!saved?.id) {
      return fail(c as any, "failed to persist revision", 500);
    }
    const revisionId = saved.id;
    await store.setActiveAppRevision(revisionId);
    const state = await store.getActiveAppRevision();
    return ok(c as any, {
      revision: saved,
      active_revision_id: state?.active_revision_id ?? revisionId,
      state,
      warnings,
    });
  } finally {
    await releaseStore(store);
  }
});

adminAppRoutes.post("/admin/app/revisions/:id/rollback", async (c) => {
  const agentGuard = guardAgentRequest(c.req, { forbidAgents: true });
  if (!agentGuard.ok) {
    return fail(c as any, agentGuard.error, agentGuard.status);
  }
  const revisionId = (c.req.param("id") || "").trim();
  if (!revisionId) {
    return fail(c as any, "revisionId is required", 400);
  }
  const store = makeData(c.env as any, c);
  try {
    if (!store.getAppRevision || !store.setActiveAppRevision || !store.getActiveAppRevision) {
      return fail(c as any, "app revisions are not supported", 501);
    }
    const revision = await store.getAppRevision(revisionId);
    if (!revision) {
      return fail(c as any, "revision not found", 404);
    }
    const versionCheck = checkSemverCompatibility(
      APP_MANIFEST_SCHEMA_VERSION,
      revision.schema_version,
      { context: "app manifest schema_version", action: "rollback" },
    );
    if (!versionCheck.ok) {
      return fail(
        c as any,
        versionCheck.error || "app manifest schema_version is not compatible",
        400,
      );
    }
    const warnings = [...versionCheck.warnings];
    await store.setActiveAppRevision(revisionId);
    const state = await store.getActiveAppRevision();
    return ok(c as any, {
      revision,
      active_revision_id: state?.active_revision_id ?? revisionId,
      state,
      warnings,
    });
  } finally {
    await releaseStore(store);
  }
});

export default adminAppRoutes;
