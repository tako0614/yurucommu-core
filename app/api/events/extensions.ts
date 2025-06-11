import { z } from "zod";
import { eventManager } from "../eventManager.ts";
import { unpackTakoPack } from "../../../packages/unpack/mod.ts";
import { Extension } from "../models/extension.ts";
import { getRuntime, loadExtension } from "../utils/extensionsRuntime.ts";

function decodeBase64(data: string): Uint8Array {
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

eventManager.add(
  "takos",
  "extensions:upload",
  z.object({ data: z.string() }),
  async (_c, payload) => {
    const bytes = decodeBase64(payload.data);
    const result = await unpackTakoPack(bytes);
    const manifest = typeof result.manifest === "string"
      ? JSON.parse(result.manifest)
      : result.manifest;

    await Extension.findOneAndUpdate(
      { identifier: manifest.identifier },
      {
        identifier: manifest.identifier,
        manifest,
        server: result.server,
        client: result.client,
        ui: result.ui, // result.index → result.ui に修正
        icon: result.icon,
      },
      { upsert: true },
    );    await loadExtension({
      identifier: manifest.identifier,
      manifest,
      server: result.server,
      client: result.client,
      ui: result.ui, // result.index → result.ui に修正
      icon: result.icon,
    });

    return { success: true };
  },
);

eventManager.add(
  "takos",
  "extensions:invoke",
  z.object({
    id: z.string(),
    fn: z.string(),
    args: z.array(z.unknown()).optional(),
  }),
  async (_c, { id, fn, args = [] }) => {
    const runtime = getRuntime(id);
    if (!runtime) {
      throw new Error("extension not found");
    }
    const result = await runtime.callServer(id, fn, args);
    return { result };
  },
);

eventManager.add(
  "takos",
  "extensions:list",
  z.null().optional(),
  async () => {
    const docs = await Extension.find();
    return docs.map((d) => ({
      identifier: d.identifier,
      name: d.manifest.name,
      icon: d.icon,
    }));
  },
);
