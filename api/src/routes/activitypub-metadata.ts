import { Hono } from "hono";
import type { PublicAccountBindings as Bindings } from "@takos/platform/server";
import { HttpError, requireInstanceDomain } from "@takos/platform/server";
import { buildActivityPubWellKnown } from "../profile/activitypub-metadata.js";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/.well-known/activitypub.json", (c) => {
  try {
    const instanceDomain = requireInstanceDomain(c.env as any);
    const payload = buildActivityPubWellKnown(instanceDomain);
    const response = c.json(payload);
    response.headers.set("Cache-Control", "public, max-age=300, immutable");
    return response;
  } catch (error) {
    console.error("[activitypub.json] failed to build metadata", error);
    throw new HttpError(500, "CONFIGURATION_ERROR", "ActivityPub metadata unavailable", {
      error: String((error as Error)?.message ?? error),
    });
  }
});

export default app;
