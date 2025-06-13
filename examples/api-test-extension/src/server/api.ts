import { ServerExtension } from "@takopack/builder/src/classes.ts";
import { getTakosServerAPI } from "@takopack/builder/src/api-helpers.ts";
import type { SerializableObject } from "@takopack/builder";

const ApiServer = new ServerExtension();

ApiServer.ping = (): string => {
  return "pong";
};

/** @event("runServerTests", { source: "ui" }) */
ApiServer.onRunServerTests = async (): Promise<
  [number, SerializableObject]
> => {
  const takos = getTakosServerAPI();
  const results: Record<string, unknown> = {};

  // KV API
  try {
    await takos?.kv.write("test", { ok: true });
    await takos?.kv.read("test");
    await takos?.kv.list();
    await takos?.kv.delete("test");
    results.kv = "ok";
  } catch (e) {
    results.kv = String(e);
  }

  // CDN API
  try {
    const path = await takos?.cdn.write(
      "test.txt",
      new TextEncoder().encode("hello"),
    );
    if (path) {
      await takos?.cdn.read(path);
      await takos?.cdn.list();
      await takos?.cdn.delete(path);
    }
    results.cdn = "ok";
  } catch (e) {
    results.cdn = String(e);
  }

  // fetch API
  try {
    const res = await takos?.fetch("https://example.com");
        console.log("Fetch status:", res?.status);
            console.log(typeof res);
    console.dir("Fetch response:", await res);

    results.fetch = res?.status ?? "no";
  } catch (e) {
    results.fetch = String(e);
  }

  // Events API
  try {
    await takos?.events.publish("clientNotify", {
      message: "サーバーテスト完了",
    });
    results.events = "ok";
  } catch (e) {
    results.events = String(e);
  }

  // ActivityPub API
  try {
    await takos?.ap.send("user", { type: "Note", content: "test" });
    await takos?.ap.read("item1");
    await takos?.ap.delete("item1");
    await takos?.ap.list("user");
    await takos?.ap.actor.read("user");
    await takos?.ap.actor.update("user", "key", "value");
    await takos?.ap.actor.delete("user", "key");
    await takos?.ap.follow("user", "user2");
    await takos?.ap.unfollow("user", "user2");
    await takos?.ap.listFollowers("user");
    await takos?.ap.listFollowing("user");
    await takos?.ap.pluginActor.create("bot", { name: "bot" });
    await takos?.ap.pluginActor.list();
    results.activitypub = "ok";
  } catch (e) {
    results.activitypub = String(e);
  }

  // Extensions API
  try {
    const ext = takos?.extensions.get("test.api");
    const api = ext ? await ext.activate() : undefined;
    if (api) {
      // deno-lint-ignore no-explicit-any
      await (api as any).ping();
    }
    results.extensions = takos?.extensions.all.length ?? 0;
  } catch (e) {
    results.extensions = String(e);
  }

  return [200, results as SerializableObject];
};

export { ApiServer };
