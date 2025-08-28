import { Hono } from "hono";
import { getDB } from "../db/mod.ts";
import { getEnv } from "@takos/config";
import authRequired from "../utils/auth.ts";
import { getDomain } from "../utils/activitypub.ts";
import { faspFetch, getFaspBaseUrl } from "../services/fasp.ts";

interface NoteDoc {
  content?: string;
  created_at?: Date | string;
}

const app = new Hono();
app.use("/trends/*", authRequired);

app.get("/trends", async (c) => {
  const env = getEnv(c);
  const domain = getDomain(c);
  const qType = c.req.query("type");
  const type = qType === "content" || qType === "links" ? qType : "hashtags";
  const withinLastHours = Number(c.req.query("withinLastHours") ?? "24");
  const maxCount = Number(c.req.query("maxCount") ?? "10");
  const faspBase = await getFaspBaseUrl(env, "trends");
  if (faspBase) {
    try {
      const params = new URLSearchParams();
      params.set("withinLastHours", String(withinLastHours));
      params.set("maxCount", String(maxCount));
      const url = `${faspBase}/trends/v0/${type}?${params.toString()}`;
      const res = await faspFetch(env, domain, url, { signing: "registered" });
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        let trends;
        if (type === "content") {
          const content = data.content as Array<{ uri: string; rank: number }>;
          trends = content.map((t) => ({ tag: t.uri, count: t.rank }));
        } else if (type === "links") {
          const links = data.links as Array<{ url: string; rank: number }>;
          trends = links.map((t) => ({ tag: t.url, count: t.rank }));
        } else {
          const hashtags = data.hashtags as Array<
            { name: string; rank: number }
          >;
          trends = hashtags.map((h) => ({ tag: `#${h.name}`, count: h.rank }));
        }
        return c.json(trends);
      }
    } catch {
      /* ignore and fallback */
    }
  }
  if (type === "hashtags") {
    const db = getDB(c);
    const since = new Date(Date.now() - withinLastHours * 60 * 60 * 1000);
    // published が過去日時の投稿も集計対象とするため、作成日時で検索する
    const notes = await db.posts.findNotes({ created_at: { $gte: since } }, {
      created_at: -1,
    }) as NoteDoc[];
    const counts: Record<string, number> = {};
    for (const n of notes) {
      if (typeof n.content !== "string") continue;
      const tags = n.content.match(/#[\p{L}\p{N}_]+/gu) ?? [];
      for (const t of tags) {
        counts[t] = (counts[t] ?? 0) + 1;
      }
    }
    const trends = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxCount)
      .map(([tag, count]) => ({ tag, count }));
    return c.json(trends);
  }
  return c.json([]);
});

export default app;
