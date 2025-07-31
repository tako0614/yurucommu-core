import { Hono } from "hono";
import { createDB } from "../DB/mod.ts";
import { getEnv } from "../../shared/config.ts";
import authRequired from "../utils/auth.ts";

interface NoteDoc {
  content?: string;
  published?: Date | string;
}

const app = new Hono();
app.use("/trends/*", authRequired);

app.get("/trends", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const notes = await db.findNotes({ published: { $gte: since } }) as NoteDoc[];
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
