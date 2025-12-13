import { Hono } from "hono";
import type { PublicAccountBindings as Bindings } from "@takos/platform/server";
import { HttpError, requireInstanceDomain } from "@takos/platform/server";
import takosProfile from "../../../takos-profile.json";

const app = new Hono<{ Bindings: Bindings }>();

interface TakosActivityPubExtensions {
  node: string;
  core_version: string;
  profile?: string;
  contexts: string[];
  extensions?: {
    id: string;
    description: string;
    spec_url: string;
  }[];
}

/**
 * Build the takos-activitypub well-known response
 * per PLAN.md section 4.2
 */
function buildTakosActivityPubExtensions(instanceDomain: string): TakosActivityPubExtensions {
  const nodeUrl = `https://${instanceDomain}`;

  return {
    node: nodeUrl,
    core_version: takosProfile.version || "0.1.0",
    profile: takosProfile.activitypub?.profile,
    contexts: takosProfile.activitypub?.contexts || [
      "https://docs.takos.jp/ns/activitypub/v1.jsonld"
    ],
    extensions: takosProfile.activitypub?.extensions || []
  };
}

/**
 * GET /.well-known/takos-activitypub
 * 
 * Publishes the node's ActivityPub extension specifications.
 * Required by PLAN.md section 4.2.
 */
app.get("/.well-known/takos-activitypub", (c) => {
  try {
    const instanceDomain = requireInstanceDomain(c.env as any);
    const payload = buildTakosActivityPubExtensions(instanceDomain);
    const response = c.json(payload);
    response.headers.set("Cache-Control", "public, max-age=300, immutable");
    response.headers.set("Content-Type", "application/json; charset=utf-8");
    return response;
  } catch (error) {
    console.error("[takos-activitypub] failed to build extensions metadata", error);
    throw new HttpError(500, "CONFIGURATION_ERROR", "ActivityPub extensions metadata unavailable", {
      error: String((error as Error)?.message ?? error),
    });
  }
});

export default app;
