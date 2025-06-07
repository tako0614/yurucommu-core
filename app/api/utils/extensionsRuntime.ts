import { TakoPack } from "../../../packages/runtime/mod.ts";
import { Extension } from "../models/extension.ts";

const runtimes = new Map<string, TakoPack>();

export async function initExtensions() {
  const docs = await Extension.find();
  for (const doc of docs) {
    await loadExtension(doc);
  }
}

export async function loadExtension(doc: typeof Extension.prototype & { identifier: string; manifest: any; server?: string; client?: string; ui?: string; }) {
  const pack = new TakoPack([
    { manifest: doc.manifest, server: doc.server, client: doc.client, ui: doc.ui },
  ]);
  await pack.init();
  runtimes.set(doc.identifier, pack);
}

export function getRuntime(id: string): TakoPack | undefined {
  return runtimes.get(id);
}
