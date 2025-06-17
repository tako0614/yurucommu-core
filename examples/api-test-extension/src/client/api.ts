import { ClientExtension } from "@takopack/builder/src/classes.ts";
import { getTakosClientAPI } from "@takopack/builder/src/api-helpers.ts";

export const ApiClient = new ClientExtension();

async function testKv() {
  const t = getTakosClientAPI();
  await t?.kv.write("client:test", "ok");
  const value = await t?.kv.read("client:test");
  await t?.kv.delete("client:test");
  return { value };
}

async function testEvents() {
  const t = getTakosClientAPI();
  await t?.events.publish("clientPing", {});
  return { ok: true };
}

async function testExtensions() {
  const t = getTakosClientAPI();
  const ext = t?.extensions.get("com.example.api-test");
  const api = await t?.activateExtension("com.example.api-test");
  return { has: !!ext, activated: typeof api?.publish === "function" };
}

async function testFetch() {
  const t = getTakosClientAPI();
  const res = await t?.fetch("https://example.com");
  return { ok: res?.ok ?? false };
}

/** @event("clientKv", { source: "ui" }) */
ApiClient.onClientKv = async (): Promise<[number, Record<string, unknown>]> => {
  return [200, await testKv()];
};

/** @event("clientEvents", { source: "ui" }) */
ApiClient.onClientEvents = async (): Promise<
  [number, Record<string, unknown>]
> => {
  return [200, await testEvents()];
};

/** @event("clientExtensions", { source: "ui" }) */
ApiClient.onClientExtensions = async (): Promise<
  [number, Record<string, unknown>]
> => {
  return [200, await testExtensions()];
};

/** @event("clientFetch", { source: "ui" }) */
ApiClient.onClientFetch = async (): Promise<
  [number, Record<string, unknown>]
> => {
  return [200, await testFetch()];
};

// Direct wrappers for event names when not using builder-generated wrappers
export function clientKv(): Promise<[number, Record<string, unknown>]> {
  return ApiClient.onClientKv();
}
export function clientEvents(): Promise<[number, Record<string, unknown>]> {
  return ApiClient.onClientEvents();
}
export function clientExtensions(): Promise<[number, Record<string, unknown>]> {
  return ApiClient.onClientExtensions();
}
export function clientFetch(): Promise<[number, Record<string, unknown>]> {
  return ApiClient.onClientFetch();
}
