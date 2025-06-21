import { z } from "zod";
import { eventManager } from "../eventManager.ts";
import { unpackTakoPack } from "../../../packages/unpack/mod.ts";
import {
  fetchPackageInfo,
  downloadAndUnpack,
  fetchRegistryIndex,
  searchRegistry,
} from "../../../packages/registry/mod.ts";
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
    );
    await loadExtension({
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
  "extensions:search",
  z.object({ q: z.string().optional(), limit: z.number().optional() }).optional(),
  async (c, { q, limit } = {}) => {
    const url = c.env.REGISTRY_URL;
    if (!url) throw new Error("REGISTRY_URL not configured");
    if (q) {
      const searchUrl = url.endsWith("/") ? `${url}search` : `${url}/search`;
      const { index } = await searchRegistry(searchUrl, { q, limit });
      return index;
    }
    const indexUrl = url.endsWith("/") ? `${url}index.json` : `${url}/index.json`;
    const { index } = await fetchRegistryIndex(indexUrl);
    return index;
  },
);

eventManager.add(
  "takos",
  "extensions:install",
  z.object({ id: z.string(), registry: z.string().url().optional() }),
  async (c, { id, registry }) => {
    const url = registry ?? c.env.REGISTRY_URL;
    if (!url) throw new Error("REGISTRY_URL not configured");
    const { pkg } = await fetchPackageInfo(url, id);
    if (!pkg) throw new Error("Package not found");
    const result = await downloadAndUnpack(pkg);
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
        ui: result.ui,
        icon: result.icon,
      },
      { upsert: true },
    );
    await loadExtension({
      identifier: manifest.identifier,
      manifest,
      server: result.server,
      client: result.client,
      ui: result.ui,
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
    options: z.object({ push: z.boolean().optional(), token: z.string().optional() }).optional(),
  }),
  async (_c, { id, fn, args = [] }) => {
    const runtime = getRuntime(id);
    if (!runtime) {
      throw new Error("extension not found");
    }
    const result = await runtime.call(id, fn, args);
    return result;
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
