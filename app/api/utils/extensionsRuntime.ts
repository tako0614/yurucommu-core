import { TakoPack } from "../../../packages/runtime/mod.ts";
import { Extension } from "../models/extension.ts";
import { WebSocketEventServer } from "../eventDistributionServer.ts";

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
    const wss = WebSocketEventServer.getInstance();
    const pack = new TakoPack([
      {
        manifest: doc.manifest,
        server: doc.server,
        client: doc.client,
        ui: doc.ui,
      },
    ], {
      events: {        publishToClient: (name: string, payload: unknown) => {
          wss?.distributeEvent(name, payload);
          return Promise.resolve();
        },
      },
    });
    await pack.init();
    runtimes.set(doc.identifier, pack);
  } catch (err) {
    console.error(`Failed to initialize extension ${doc.identifier}:`, err);
  }
}

export function getRuntime(id: string): TakoPack | undefined {
  return runtimes.get(id);
}
