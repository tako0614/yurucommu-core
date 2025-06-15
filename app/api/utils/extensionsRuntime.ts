import { TakoPack } from "../../../packages/runtime/mod.ts";
import { Extension } from "../models/extension.ts";
import { WebSocketManager } from "../websocketHandler.ts";
import { KVItem } from "../models/kv.ts";

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
  try {    const wsManager = WebSocketManager.getInstance();
    const pack = new TakoPack([
      {
        manifest: doc.manifest,
        server: doc.server,
        client: doc.client,
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
      client: {},
    });

    await pack.init();

    // Forward client events to the server runtime
    pack.setClientPublish(
      (
        name: string,
        payload: unknown,
        options?: { push?: boolean },
      ) => {
        return pack.callServer(doc.identifier, name, [payload, options]);
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
