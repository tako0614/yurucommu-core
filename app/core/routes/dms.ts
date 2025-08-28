import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import authRequired from "../utils/auth.ts";
import { getDB } from "../db/mod.ts";
import { getEnv } from "@takos/config";
import { saveFile } from "../services/file.ts";
import type { DirectMessageDoc } from "@takos/types";

const app = new Hono();
app.use("/dms/*", authRequired);

app.get("/dms", async (c) => {
  const owner = c.req.query("owner");
  if (!owner) return c.json({ error: "owner is required" }, 400);
  const db = getDB(c);
  const rooms = await db.listDirectMessages(owner) as DirectMessageDoc[];
  const formatted = rooms.map((r) => ({
    id: r.id,
    owner: r.owner,
    name: r.name,
    icon: r.icon,
    members: r.members ?? [],
  }));
  return c.json(formatted);
});

app.post(
  "/dms",
  zValidator(
    "json",
    z.object({
      owner: z.string(),
      id: z.string(),
      name: z.string(),
      members: z.array(z.string()).optional(),
    }),
  ),
  async (c) => {
    const { owner, id, name, members = [] } = c.req.valid("json") as {
      owner: string;
      id: string;
      name: string;
      members?: string[];
    };
    const db = getDB(c);
    const room = await db.createDirectMessage({
      owner,
      id,
      name,
      members,
    });
    return c.json(room);
  },
);

app.patch(
  "/dms/:id",
  zValidator(
    "json",
    z.object({ owner: z.string(), name: z.string().optional() }),
  ),
  async (c) => {
    const id = c.req.param("id");
    const { owner, name } = c.req.valid("json") as {
      owner: string;
      name?: string;
    };
    const db = getDB(c);
    const room = await db.updateDirectMessage(owner, id, { name });
    if (!room) return c.json({ error: "not found" }, 404);
    return c.json(room);
  },
);

app.post("/dms/:id/icon", async (c) => {
  const owner = c.req.query("owner");
  if (!owner) return c.json({ error: "owner is required" }, 400);
  const id = c.req.param("id");
  const env = getEnv(c);
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "file is required" }, 400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = file.name.split(".").pop();
  const saved = await saveFile(bytes, env, {
    mediaType: file.type,
    ext: ext ? `.${ext}` : undefined,
  });
  const db = getDB(c);
  await db.updateDirectMessage(owner, id, { icon: saved.url });
  return c.json({ url: saved.url });
});

app.delete("/dms/:id", async (c) => {
  const owner = c.req.query("owner");
  if (!owner) return c.json({ error: "owner is required" }, 400);
  const id = c.req.param("id");
  const db = getDB(c);
  const ok = await db.deleteDirectMessage(owner, id);
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.json({ success: true });
});

export default app;
