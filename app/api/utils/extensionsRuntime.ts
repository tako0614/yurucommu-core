import { TakoPack } from "../../../packages/runtime/mod.ts";
import { Extension } from "../models/extension.ts";
import { WebSocketManager } from "../websocketHandler.ts";
import { KVItem } from "../models/kv.ts";
import { sendFCM } from "./fcm.ts";

const serviceAccountStr = Deno.env.get("SERVICE_ACCOUNT_JSON");
const serviceAccount = serviceAccountStr ? JSON.parse(serviceAccountStr) : null;

const runtimes = new Map<string, TakoPack>();

export async function initExtensions() {
  const docs = await Extension.find();
  for (const doc of docs) {
    try {
      await loadExtension(doc);
    } catch (err) {
      console.error(`Failed to load extension ${doc.identifier}:`, err);
    }
  }
}

export async function loadExtension(
  doc: {
    identifier: string;
    manifest: Record<string, unknown>;
    server?: string;
    client?: string;
    ui?: string;
    icon?: string;
  },
) {
  try {
    const wsManager = WebSocketManager.getInstance();
    const pack = new TakoPack([
      {
        manifest: doc.manifest,
        server: doc.server,
        ui: doc.ui,
      },
    ], {
      server: {
        events: {
          publish: (name: string, payload: unknown) => {
            wsManager.distributeEvent(name, payload);
            return Promise.resolve(undefined);
          },
        },
        kv: {
          read: async (key: string) => {
            const item = await KVItem.findOne({
              identifier: doc.identifier,
              side: "server",
              key,
            });
            return item ? item.value : undefined;
          },
          write: async (key: string, value: unknown) => {
            await KVItem.findOneAndUpdate(
              { identifier: doc.identifier, side: "server", key },
              { value },
              { upsert: true },
            );
          },
          delete: async (key: string) => {
            await KVItem.deleteOne({
              identifier: doc.identifier,
              side: "server",
              key,
            });
          },
          list: async (prefix?: string) => {
            const query: Record<string, unknown> = {
              identifier: doc.identifier,
              side: "server",
            };
            if (prefix) query.key = { $regex: "^" + prefix };
            const docs = await KVItem.find(query).select("key");
            return docs.map((d) => d.key);
          },
        },
      },
    });

    await pack.init();

    // Forward client events to connected clients only
    pack.setClientPublish(
      async (
        name: string,
        payload: unknown,
        options?: { push?: boolean; token?: string },
      ) => {
        wsManager.distributeEvent(name, payload);
        if (options?.push && options.token && serviceAccount) {
          await sendFCM(serviceAccount, options.token, {
            id: doc.identifier,
            fn: name,
            args: [payload],
          }).catch((err) => console.error("FCM error", err));
        }
        return undefined;
      },
    );
    runtimes.set(doc.identifier, pack);
  } catch (err) {
    console.error(`Failed to initialize extension ${doc.identifier}:`, err);
  }
}

export function getRuntime(id: string): TakoPack | undefined {
  return runtimes.get(id);
}
