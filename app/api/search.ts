import { Hono } from "hono";
import Account from "./models/account.ts";
import ActivityPubObject from "./models/activitypub_object.ts";
import Group from "./models/group.ts";
import { getDomain, resolveActor } from "./utils/activitypub.ts";

interface SearchResult {
  type: "user" | "post" | "community";
  id: string;
  title: string;
  subtitle: string;
  avatar?: string;
  actor?: string;
  origin?: string;
  metadata?: { createdAt?: Date };
}

const app = new Hono();

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

  const regex = new RegExp(q, "i");
  const results: SearchResult[] = [];

  if (type === "all" || type === "users") {
    const users = await Account.find({
      $or: [{ userName: regex }, { displayName: regex }],
    })
      .limit(20)
      .lean();
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
    const posts = await ActivityPubObject.find({ type: "Note", content: regex })
      .limit(20)
      .lean();
    const domain = getDomain(c);
    for (const p of posts) {
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

  if (type === "all" || type === "communities") {
    const communities = await Group.find({
      $or: [
        { name: regex },
        { description: regex },
      ],
    })
      .limit(20)
      .lean();
    const domain = getDomain(c);
    for (const com of communities) {
      results.push({
        type: "community",
        id: String(com._id),
        title: com.name,
        subtitle: com.description,
        origin: domain,
        metadata: {},
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
