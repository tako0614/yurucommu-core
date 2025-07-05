import { Hono } from "hono";
import Account from "./models/account.ts";
import ActivityPubObject from "./models/activitypub_object.ts";
import { env } from "./utils/env.ts";

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

app.get("/search", async (c) => {
  const q = c.req.query("q")?.trim();
  const type = c.req.query("type") ?? "all";
  const server = c.req.query("server");
  if (!q) return c.json([]);

  const regex = new RegExp(q, "i");
  const results: SearchResult[] = [];

  if (type === "all" || type === "users") {
    const users = await Account.find({
      $or: [{ userName: regex }, { displayName: regex }],
    })
      .limit(20)
      .lean();
    const domain = env["ACTIVITYPUB_DOMAIN"] ?? new URL(c.req.url).host;
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
    const domain = env["ACTIVITYPUB_DOMAIN"] ?? new URL(c.req.url).host;
    for (const p of posts) {
      results.push({
        type: "post",
        id: String(p._id),
        title: p.content.slice(0, 80),
        subtitle: p.attributedTo,
        metadata: { createdAt: p.published },
        origin: domain,
      });
    }
  }

  if (server) {
    try {
      const url = `https://${server}/api/search?q=${
        encodeURIComponent(q)
      }&type=${type}`;
      const res = await fetch(url);
      if (res.ok) {
        const remote: SearchResult[] = await res.json();
        for (const r of remote) {
          results.push({ ...r, origin: server });
        }
      }
    } catch {
      /* ignore */
    }
  }

  return c.json(results);
});

export default app;
