import { Hono } from "hono";
import { createDB } from "../DB/mod.ts";
import { getEnv } from "../../shared/config.ts";
import authRequired from "../utils/auth.ts";
import { getFaspBaseUrl } from "../services/fasp.ts";

interface NoteDoc {
  content?: string;
  created_at?: Date | string;
}

const app = new Hono();
app.use("/trends/*", authRequired);

app.get("/trends", async (c) => {
  const env = getEnv(c);
  const faspBase = await getFaspBaseUrl(env, "trends");
  if (faspBase) {
    try {
      const url =
        `${faspBase}/trends/v0/hashtags?withinLastHours=24&maxCount=10`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.ok) {
        const data = await res.json() as {
          hashtags: Array<{ name: string; rank: number }>;
        };
        const trends = data.hashtags.map((h) => ({
          tag: `#${h.name}`,
          count: h.rank,
        }));
        return c.json(trends);
      }
    } catch {
      /* ignore and fallback */
    }
  }
  const db = createDB(env);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // published が過去日時の投稿も集計対象とするため、作成日時で検索する
  const notes = await db.findNotes({ created_at: { $gte: since } }, {
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
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));
  return c.json(trends);
});

export default app;
