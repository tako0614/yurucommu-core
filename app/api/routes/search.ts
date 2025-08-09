import { Hono } from "hono";
import { createDB } from "../DB/mod.ts";
import { getDomain, resolveActor } from "../utils/activitypub.ts";
import { getEnv } from "../../shared/config.ts";
import authRequired from "../utils/auth.ts";
import { getFaspBaseUrl } from "../services/fasp.ts";

interface SearchResult {
  type: "user" | "post" | "video";
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
    const env = getEnv(c);
    const db = createDB(env);
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

    const faspBase = await getFaspBaseUrl(env, "account_search");
    if (faspBase) {
      try {
        const url = `${faspBase}/account_search/v0/search?term=${
          encodeURIComponent(q)
        }&limit=20`;
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const list = await res.json() as string[];
          await Promise.all(
            list.map(async (uri) => {
              if (results.some((r) => r.actor === uri)) return;
              try {
                const aRes = await fetch(uri, {
                  headers: {
                    Accept:
                      'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
                  },
                });
                if (!aRes.ok) return;
                const actor = await aRes.json();
                const host = (() => {
                  try {
                    return new URL(uri).hostname;
                  } catch {
                    return "";
                  }
                })();
                results.push({
                  type: "user",
                  id: actor.id ?? uri,
                  title: actor.name ?? actor.preferredUsername ?? uri,
                  subtitle: actor.preferredUsername
                    ? `@${actor.preferredUsername}@${host}`
                    : uri,
                  avatar: actor.icon?.url,
                  actor: actor.id ?? uri,
                  origin: host,
                });
              } catch {
                /* ignore */
              }
            }),
          );
        }
      } catch {
        /* ignore */
      }
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

  if (type === "all" || type === "videos") {
    const env = getEnv(c);
    const db = createDB(env);
    const videos = await db.findVideos({
      $or: [
        { content: regex },
        { "extra.title": regex },
      ],
    }, { published: -1 });
    const sliced = (videos as Array<
      { _id?: unknown; extra: Record<string, unknown>; attributedTo: string }
    >).slice(0, 20);
    const domain = getDomain(c);
    for (const v of sliced) {
      results.push({
        type: "video",
        id: String(v._id),
        title: (v.extra?.title as string) ?? "",
        subtitle: v.attributedTo,
        avatar: v.extra?.thumbnail as string | undefined,
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
