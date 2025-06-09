import { z } from "zod";
import { eventManager } from "../eventManager.ts";
import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";

const base = "takos";
const CDN_ROOT = join(dirname(dirname(import.meta.url)), "public", "cdn");

function safePath(id: string, path: string): string {
  const p = path.replace(/\.\.\//g, "");
  return join(CDN_ROOT, id, p);
}

eventManager.add(
  base,
  "cdn:write",
  z.object({
    id: z.string(),
    path: z.string(),
    data: z.string(),
    cacheTTL: z.number().optional(),
  }),
  async (_c, { id, path, data }) => {
    const file = safePath(id, path);
    await ensureDir(dirname(file));
    const bytes = data.startsWith("data:")
      ? Uint8Array.from(atob(data.split(",")[1]), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(data);
    await Deno.writeFile(file, bytes);
    return { url: `/cdn/${id}/${path}` };
  },
);

eventManager.add(
  base,
  "cdn:read",
  z.object({ id: z.string(), path: z.string() }),
  async (_c, { id, path }) => {
    const file = safePath(id, path);
    return await Deno.readTextFile(file);
  },
);

eventManager.add(
  base,
  "cdn:delete",
  z.object({ id: z.string(), path: z.string() }),
  async (_c, { id, path }) => {
    const file = safePath(id, path);
    await Deno.remove(file);
    return { success: true };
  },
);

eventManager.add(
  base,
  "cdn:list",
  z.object({ id: z.string(), prefix: z.string().optional() }),
  async (_c, { id, prefix }) => {
    const dir = join(CDN_ROOT, id);
    try {
      const entries = [] as string[];
      for await (const entry of Deno.readDir(dir)) {
        if (!prefix || entry.name.startsWith(prefix)) entries.push(entry.name);
      }
      return entries;
    } catch {
      return [];
    }
  },
);
