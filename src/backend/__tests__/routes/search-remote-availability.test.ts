import { expect, test } from "bun:test";
import { resolve } from "node:path";

// Other route tests mock the federation module in-process. Run this real route
// in a fresh process so those mocks cannot produce a false positive here, and
// this test's network failure seam cannot affect another route's tests.
const program = String.raw`
import { mock } from "bun:test";
import { Hono } from "hono";
import { resolve } from "node:path";
import { createTestDb } from "./src/backend/__tests__/helpers/d1-semantics.ts";
import { actorCache, instanceActor } from "./src/db/index.ts";
let mode = "", requested = [], signed = false;
const actorId = "https://remote-actor.example/users/alice";
const webfinger = (href = actorId) => Response.json({subject:"acct:alice@lookup.example",
  links:[{rel:"self",type:"application/activity+json",href}]});
mock.module(resolve("src/backend/lib/federation-fetch.ts"), () => ({
  FederationBodyTooLargeError: class FederationBodyTooLargeError extends Error {},
  fetchWithTimeout: async (url, options) => {
    requested.push(url);
    const phase = url.includes("/.well-known/webfinger?") ? "web" : "actor";
    if (mode === phase + "-throw") throw Error("private-upstream-marker");
    if (mode === phase + "-json") return new Response("{");
    const status = mode.startsWith(phase + "-") ? Number(mode.slice(phase.length + 1)) : 0;
    if (status) return new Response("private-upstream-marker", {status});
    if (phase === "web") return webfinger(mode === "unsafe" ? "http://127.0.0.1/private" : actorId);
    if (url !== actorId) throw Error("Unexpected outbound target");
    const headers = new Headers(options.headers);
    signed = !!headers.get("signature") && !!headers.get("date");
    return Response.json({id:actorId,type:"Person",preferredUsername:"alice",name:"Alice",
      inbox:actorId+"/inbox",outbox:actorId+"/outbox",followers:actorId+"/followers",following:actorId+"/following"});
  },
}));
const {default: routes} = await import("./src/backend/routes/search.ts");
const {blockDomain, blockActor} = await import("./src/backend/lib/blocklist.ts");
const {generateKeyPair} = await import("./src/backend/federation-helpers.ts");
// Ephemeral fixture material remains in memory. It is neither an operator
// credential nor a claimed remote identity; the actual signing call is kept.
const pair = await generateKeyPair(), results = {};
for (mode of ["web-throw","actor-throw","web-json","actor-json","web-503","web-429","actor-503","actor-429",
  "web-404","web-410","actor-404","actor-410","blocked-domain","blocked-actor","unsafe","invalid","valid"]) {
  const fixture = await createTestDb(); requested = []; signed = false;
  try {
    const host = "https://local-search.example";
    await fixture.db.insert(instanceActor).values({apId:host+"/ap/actor",preferredUsername:"community",
      publicKeyPem:pair.publicKeyPem,privateKeyPem:pair.privateKeyPem});
    if (mode === "blocked-domain") await blockDomain(fixture.db,"lookup.example","fixture block");
    if (mode === "blocked-actor") await blockActor(fixture.db,actorId,"fixture block");
    const app = new Hono();
    app.use("*",async(c,next)=>{c.set("db",fixture.db);await next();}); app.route("/api/search",routes);
    const query = mode === "invalid" ? "not a remote handle" : "@alice@lookup.example";
    const response = await app.fetch(new Request(host+"/api/search/remote?q="+encodeURIComponent(query)),{APP_URL:host});
    const body = await response.json();
    const cached = await fixture.db.select({apId:actorCache.apId}).from(actorCache);
    results[mode] = {status:response.status,body,requested:[...requested],signed,cached:cached.map(row=>row.apId)};
  } finally { fixture.client.close(); }
}
console.log("REMOTE_AVAILABILITY_RESULT " + JSON.stringify(results));
`;

type Lookup = {
  status: number;
  body: { actors?: { ap_id: string }[]; error?: string; code?: string };
  requested: string[];
  signed: boolean;
  cached: string[];
};
let pending: Promise<Record<string, Lookup>> | undefined;
function results() {
  return (pending ??= (async () => {
    const child = Bun.spawn(
      [process.execPath, "--no-env-file", "-e", program],
      {
        cwd: resolve(import.meta.dir, "../../../.."),
        env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exit !== 0)
      throw new Error(`Isolated search fixture failed: ${stderr}`);
    const line = stdout
      .split("\n")
      .find((line) => line.startsWith("REMOTE_AVAILABILITY_RESULT "));
    if (!line)
      throw new Error("Isolated search fixture did not return results");
    return JSON.parse(
      line.slice("REMOTE_AVAILABILITY_RESULT ".length),
    ) as Record<string, Lookup>;
  })());
}

test("remote transport and response-body failures are explicit unavailable responses", async () => {
  const all = await results();
  for (const mode of ["web-throw", "actor-throw", "web-json", "actor-json"]) {
    const item = all[mode]!;
    expect(item.status).toBe(503);
    expect(item.body).toEqual({
      error: "Remote search unavailable",
      code: "REMOTE_SEARCH_UNAVAILABLE",
    });
    expect(JSON.stringify(item.body)).not.toContain("private-upstream-marker");
    expect(item.cached).toEqual([]);
  }
});

test("upstream temporary HTTP failures do not become successful empty results", async () => {
  const all = await results();
  for (const mode of ["web-503", "web-429", "actor-503", "actor-429"]) {
    expect(all[mode]!.status).toBe(503);
    expect(all[mode]!.body.code).toBe("REMOTE_SEARCH_UNAVAILABLE");
    expect(all[mode]!.cached).toEqual([]);
  }
});

test("genuine upstream absence retains successful empty search semantics", async () => {
  const all = await results();
  for (const mode of ["web-404", "web-410", "actor-404", "actor-410"]) {
    expect(all[mode]!.status).toBe(200);
    expect(all[mode]!.body).toEqual({ actors: [] });
    expect(all[mode]!.cached).toEqual([]);
  }
});

test("invalid, blocked and unsafe lookups retain their guards and do not fetch the forbidden actor", async () => {
  const all = await results();
  for (const mode of ["invalid", "blocked-domain", "blocked-actor", "unsafe"]) {
    expect(all[mode]!.status).toBe(200);
    expect(all[mode]!.body).toEqual({ actors: [] });
    expect(all[mode]!.cached).toEqual([]);
    expect(all[mode]!.requested).toHaveLength(
      mode === "invalid" || mode === "blocked-domain" ? 0 : 1,
    );
    expect(all[mode]!.signed).toBe(false);
  }
});

test("a valid lookup still signs the actor GET and caches the validated remote actor", async () => {
  const item = (await results()).valid!;
  expect(item.status).toBe(200);
  expect(item.body.actors?.map((actor) => actor.ap_id)).toEqual([
    "https://remote-actor.example/users/alice",
  ]);
  expect(item.requested).toHaveLength(2);
  expect(item.signed).toBe(true);
  expect(item.cached).toEqual(["https://remote-actor.example/users/alice"]);
});
