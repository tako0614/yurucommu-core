/// <reference types="@cloudflare/workers-types" />

import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { ok } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { requireHumanSession, requireWorkspacePlan } from "../lib/workspace-guard";

const handlerDts = `declare module "takos/handler" {
  export type {
    TakosApp,
    AppEnv,
    AppStorage,
    ActivityPubAPI,
    AiAPI,
    AuthInfo,
    AppInfo,
    Activity,
    AiCompleteOptions,
    AiEmbedOptions
  } from "@takos/app-sdk/server";
}
`;

const manifestDts = `declare module "takos/manifest" {
  export type { AppManifest, AppEntry } from "@takos/app-sdk/server";
}
`;

const appIde = new Hono<{ Bindings: Bindings; Variables: Variables }>();

appIde.use("/-/dev/ide/*", auth, requireHumanSession, requireWorkspacePlan);

appIde.get("/-/dev/ide/types", async (c) => {
  return ok(c as any, {
    files: [
      { path: "takos/handler.d.ts", content: handlerDts },
      { path: "takos/manifest.d.ts", content: manifestDts },
    ],
  });
});

// The following endpoints provide a stable surface for Web IDE integration.
// MVP returns empty results; Monaco/TS language service can be layered on later.
appIde.post("/-/dev/ide/completions", async (c) => ok(c as any, { items: [] }));
appIde.post("/-/dev/ide/diagnostics", async (c) => ok(c as any, { diagnostics: [] }));
appIde.post("/-/dev/ide/hover", async (c) => ok(c as any, { hover: null }));
appIde.post("/-/dev/ide/definition", async (c) => ok(c as any, { locations: [] }));
appIde.post("/-/dev/ide/references", async (c) => ok(c as any, { locations: [] }));

export default appIde;

