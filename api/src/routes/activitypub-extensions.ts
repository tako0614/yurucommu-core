import { Hono } from "hono";
import type { PublicAccountBindings as Bindings } from "@takos/platform/server";
import { requireInstanceDomain } from "@takos/platform/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
  // Try to load takos-profile.json
  let profile: any = null;
  try {
    // In production, this would be loaded from the deployment
    // For now, we'll construct a minimal response
    profile = {
      version: "0.1.0",
      activitypub: {
        contexts: ["https://takos.io/ap/context/takos-core.v1.jsonld"],
        profile: "https://docs.takos.jp/",
        extensions: [
          {
            id: "takos-core-ap",
            description: "Core takos ActivityPub handlers for posts, questions, and announces.",
            spec_url: "https://docs.takos.jp/activitypub"
          }
        ]
      }
    };
  } catch (err) {
    console.warn("[takos-activitypub] Could not load takos-profile.json", err);
  }

  const nodeUrl = `https://${instanceDomain}`;
  
  return {
    node: nodeUrl,
    core_version: profile?.version || "0.1.0",
    profile: profile?.activitypub?.profile,
    contexts: profile?.activitypub?.contexts || [
      "https://takos.io/ap/context/takos-core.v1.jsonld"
    ],
    extensions: profile?.activitypub?.extensions || []
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
    return c.json(
      { ok: false, error: "takos-activitypub metadata unavailable" },
      500
    );
  }
});

export default app;
