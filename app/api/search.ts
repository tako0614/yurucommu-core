import { Hono } from "hono";
import { createDB } from "./DB/mod.ts";
import { getDomain, resolveActor } from "./utils/activitypub.ts";
import { getEnv } from "../shared/config.ts";
import authRequired from "./utils/auth.ts";

interface SearchResult {
  type: "user" | "post";
  id: string;
  title: string;
  subtitle: string;
  avatar?: string;
  actor?: string;
  origin?: string;
  metadata?: { createdAt?: Date };
}

const app = new Hono();
app.use("/search/*", authRequired);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

app.get("/search", async (c) => {
  let q = c.req.query("q")?.trim();
  const type = c.req.query("type") ?? "all";
  let server = c.req.query("server");
  if (!q) return c.json([]);

  if (!server && q.includes("@")) {
    const parts = q.split("@");
    if (parts.length === 2 && parts[0] && parts[1]) {
      q = parts[0];
      server = parts[1];
    }
  }

  const regex = new RegExp(escapeRegex(q), "i");
  const results: SearchResult[] = [];

  if (type === "all" || type === "users") {
    const db = createDB(getEnv(c));
    const users = await db.searchAccounts(regex, 20);
    const domain = getDomain(c);
    for (const u of users) {
      results.push({
        type: "user",
        id: String(u._id),
        title: u.displayName,
        subtitle: `@${u.userName}`,
        avatar: u.avatarInitial,
        actor: `https://${domain}/users/${u.userName}`,
        origin: domain,
      });
    }
  }

  if (type === "all" || type === "posts") {
    const env = getEnv(c);
    const db = createDB(env);
    const posts = await db.findNotes({ content: regex }, {
      published: -1,
    }) as Array<{
      _id?: unknown;
      content?: string;
      attributedTo: string;
      published?: Date;
    }>;
    const sliced = posts.slice(0, 20);
    const domain = getDomain(c);
    for (const p of sliced) {
      results.push({
        type: "post",
        id: String(p._id),
        title: (p.content ?? "").slice(0, 80),
        subtitle: p.attributedTo,
        metadata: { createdAt: p.published },
        origin: domain,
      });
    }
  }

  if (server) {
    let remoteResults: SearchResult[] = [];
    try {
      const url = `https://${server}/api/search?q=${
        encodeURIComponent(q)
      }&type=${type}`;
      const res = await fetch(url);
      if (res.ok) {
        remoteResults = await res.json();
        for (const r of remoteResults) {
          results.push({ ...r, origin: server });
        }
      }
    } catch {
      /* ignore */
    }

    if (
      (type === "all" || type === "users") &&
      !remoteResults.some((r) => r.type === "user")
    ) {
      const actor = await resolveActor(q, server);
      if (actor) {
        results.push({
          type: "user",
          id: actor.id,
          title: actor.name ?? actor.preferredUsername ?? q,
          subtitle: `@${actor.preferredUsername ?? q}`,
          avatar: actor.icon?.url,
          actor: actor.id,
          origin: server,
        });
      }
    }
  }

  return c.json(results);
});

export default app;
