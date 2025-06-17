import { ServerExtension } from "@takopack/builder/src/classes.ts";
import { getTakosServerAPI } from "@takopack/builder/src/api-helpers.ts";

export const ApiServer = new ServerExtension();

function getApi() {
  return getTakosServerAPI();
}

async function testKv() {
  const t = getApi();
  await t?.kv.write("server:test", "ok");
  const value = await t?.kv.read("server:test");
  const list = await t?.kv.list();
  await t?.kv.delete("server:test");
  return { value, list };
}

async function testCdn() {
  const t = getApi();
  await t?.cdn.write("srv.txt", "hello", { cacheTTL: 0 });
  const data = await t?.cdn.read("srv.txt");
  const list = await t?.cdn.list();
  await t?.cdn.delete("srv.txt");
  return { data, list };
}

async function testEvents() {
  const t = getApi();
  await t?.events.publish("srvPing", {});
  return { ok: true };
}

async function testActivityPub() {
  const t = getApi();
  await t?.activitypub.send("srv", { type: "Note" });
  await t?.activitypub.read("id:srv");
  await t?.activitypub.delete("id:srv");
  await t?.activitypub.list("srv");
  await t?.activitypub.actor.read("srv");
  await t?.activitypub.actor.update("srv", "k", "v");
  await t?.activitypub.actor.delete("srv", "k");
  await t?.activitypub.follow("srv", "you");
  await t?.activitypub.unfollow("srv", "you");
  await t?.activitypub.listFollowers("srv");
  await t?.activitypub.listFollowing("srv");
  await t?.activitypub.pluginActor.create("bot", {});
  await t?.activitypub.pluginActor.read("bot");
  await t?.activitypub.pluginActor.update("bot", {});
  await t?.activitypub.pluginActor.delete("bot");
  await t?.activitypub.pluginActor.list();
  return { ok: true };
}

async function testExtensions() {
  const t = getApi();
  const ext = t?.extensions.get("com.example.api-test");
  const api = await t?.activateExtension("com.example.api-test");
  return { has: !!ext, activated: typeof api?.publish === "function" };
}

async function testFetch() {
  const t = getApi();
  const res = await t?.fetch("https://example.com");
  return { ok: res?.ok ?? false };
}

/** @event("serverKv", { source: "ui" }) */
ApiServer.onServerKv = async (): Promise<[number, Record<string, unknown>]> => {
  return [200, await testKv()];
};

/** @event("serverCdn", { source: "ui" }) */
ApiServer.onServerCdn = async (): Promise<
  [number, Record<string, unknown>]
> => {
  return [200, await testCdn()];
};

/** @event("serverEvents", { source: "ui" }) */
ApiServer.onServerEvents = async (): Promise<
  [number, Record<string, unknown>]
> => {
  return [200, await testEvents()];
};

/** @event("serverActivityPub", { source: "ui" }) */
ApiServer.onServerActivityPub = async (): Promise<
  [number, Record<string, unknown>]
> => {
  return [200, await testActivityPub()];
};

/** @event("serverExtensions", { source: "ui" }) */
ApiServer.onServerExtensions = async (): Promise<
  [number, Record<string, unknown>]
> => {
  return [200, await testExtensions()];
};

/** @event("serverFetch", { source: "ui" }) */
ApiServer.onServerFetch = async (): Promise<
  [number, Record<string, unknown>]
> => {
  return [200, await testFetch()];
};

// Direct wrappers for event names when not using the builder-generated wrappers
export function serverKv(): Promise<[number, Record<string, unknown>]> {
  return ApiServer.onServerKv();
}
export function serverCdn(): Promise<[number, Record<string, unknown>]> {
  return ApiServer.onServerCdn();
}
export function serverEvents(): Promise<[number, Record<string, unknown>]> {
  return ApiServer.onServerEvents();
}
export function serverActivityPub(): Promise<
  [number, Record<string, unknown>]
> {
  return ApiServer.onServerActivityPub();
}
export function serverExtensions(): Promise<[number, Record<string, unknown>]> {
  return ApiServer.onServerExtensions();
}
export function serverFetch(): Promise<[number, Record<string, unknown>]> {
  return ApiServer.onServerFetch();
}
