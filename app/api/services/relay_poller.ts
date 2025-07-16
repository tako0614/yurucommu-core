import { listPullRelays, saveObject } from "./unified_store.ts";
import { fetchJson } from "../utils/activitypub.ts";

export function startRelayPolling(env: Record<string, string>) {
  const tenant = env["ACTIVITYPUB_DOMAIN"] ?? "";
  const interval = Number(env["RELAY_POLL_INTERVAL"] ?? "300000");
  if (!tenant) return;
  setInterval(async () => {
    try {
      const relays = await listPullRelays(tenant);
      for (const relay of relays) {
        try {
          const data = await fetchJson<{ items?: unknown[] }>(
            `https://${relay}/api/microblog?limit=20`,
            {},
            undefined,
            env,
          );
          const items = Array.isArray(data.items) ? data.items : [];
          for (const item of items) {
            if (item && typeof item === "object") {
              await saveObject(env, item as Record<string, unknown>);
            }
          }
        } catch (err) {
          console.error("relay poll failed", relay, err);
        }
      }
    } catch (err) {
      console.error("relay polling error", err);
    }
  }, interval);
}
