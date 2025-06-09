import { z } from "zod";
import { eventManager } from "../eventManager.ts";
import { KVItem } from "../models/kv.ts";

const base = "takos";

eventManager.add(
  base,
  "kv:read",
  z.object({
    id: z.string(),
    key: z.string(),
    side: z.enum(["client", "server"]).optional(),
  }),
  async (_c, { id, key, side = "client" }) => {
    const doc = await KVItem.findOne({ identifier: id, side, key });
    return doc ? doc.value : null;
  },
);

eventManager.add(
  base,
  "kv:write",
  z.object({
    id: z.string(),
    key: z.string(),
    value: z.any(),
    side: z.enum(["client", "server"]).optional(),
  }),
  async (_c, { id, key, value, side = "client" }) => {
    await KVItem.findOneAndUpdate(
      { identifier: id, side, key },
      { value },
      { upsert: true },
    );
    return { success: true };
  },
);

eventManager.add(
  base,
  "kv:delete",
  z.object({
    id: z.string(),
    key: z.string(),
    side: z.enum(["client", "server"]).optional(),
  }),
  async (_c, { id, key, side = "client" }) => {
    await KVItem.deleteOne({ identifier: id, side, key });
    return { success: true };
  },
);

eventManager.add(
  base,
  "kv:list",
  z.object({
    id: z.string(),
    prefix: z.string().optional(),
    side: z.enum(["client", "server"]).optional(),
  }),
  async (_c, { id, prefix, side = "client" }) => {
    const query: Record<string, unknown> = { identifier: id, side };
    if (prefix) query.key = { $regex: "^" + prefix };
    const docs = await KVItem.find(query).select("key");
    return docs.map((d) => d.key);
  },
);
