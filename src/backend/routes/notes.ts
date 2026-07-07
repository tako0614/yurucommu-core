import { Hono } from "hono";
import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { actorNotes, actors, follows, type Database } from "../../db/index.ts";
import type { Env, Variables } from "../types.ts";
import { formatUsername } from "../federation-helpers.ts";
import { excludeBlockedMutedAuthors } from "../lib/feed-exclude.ts";

const notes = new Hono<{ Bindings: Env; Variables: Variables }>();

const MAX_NOTE_CONTENT_LENGTH = 80;
const DEFAULT_NOTE_TTL_HOURS = 24;
const MIN_NOTE_TTL_HOURS = 1;
const MAX_NOTE_TTL_HOURS = 24;
const MAX_NOTE_FEED_ITEMS = 60;

type NoteRow = {
  actorApId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  preferredUsername: string;
  name: string | null;
  iconUrl: string | null;
};

type NoteResponse = {
  actor: {
    ap_id: string;
    username: string;
    preferred_username: string;
    name: string | null;
    icon_url: string | null;
  };
  content: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  is_mine: boolean;
};

function sanitizeContent(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const content = input.trim();
  if (content.length === 0 || content.length > MAX_NOTE_CONTENT_LENGTH) {
    return null;
  }
  return content;
}

function ttlHours(input: unknown): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return DEFAULT_NOTE_TTL_HOURS;
  }
  return Math.min(
    MAX_NOTE_TTL_HOURS,
    Math.max(MIN_NOTE_TTL_HOURS, Math.floor(input)),
  );
}

function formatNote(row: NoteRow, viewerApId: string): NoteResponse {
  return {
    actor: {
      ap_id: row.actorApId,
      username: formatUsername(row.actorApId),
      preferred_username: row.preferredUsername,
      name: row.name,
      icon_url: row.iconUrl,
    },
    content: row.content,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    expires_at: row.expiresAt,
    is_mine: row.actorApId === viewerApId,
  };
}

async function loadActiveNotes(
  db: Database,
  viewerApId: string,
): Promise<NoteRow[]> {
  const now = new Date().toISOString();
  const followingSubquery = db
    .select({ id: follows.followingApId })
    .from(follows)
    .where(
      and(eq(follows.followerApId, viewerApId), eq(follows.status, "accepted")),
    );

  const filters: SQL[] = [
    isNull(actorNotes.deletedAt),
    isNull(actors.deletedAt),
    gt(actorNotes.expiresAt, now),
    or(
      eq(actorNotes.actorApId, viewerApId),
      inArray(actorNotes.actorApId, followingSubquery),
    )!,
  ];
  const excludeAuthors = excludeBlockedMutedAuthors(
    db,
    viewerApId,
    actorNotes.actorApId,
  );
  if (excludeAuthors) filters.push(excludeAuthors);

  return await db
    .select({
      actorApId: actorNotes.actorApId,
      content: actorNotes.content,
      createdAt: actorNotes.createdAt,
      updatedAt: actorNotes.updatedAt,
      expiresAt: actorNotes.expiresAt,
      preferredUsername: actors.preferredUsername,
      name: actors.name,
      iconUrl: actors.iconUrl,
    })
    .from(actorNotes)
    .innerJoin(actors, eq(actorNotes.actorApId, actors.apId))
    .where(and(...filters))
    .orderBy(desc(actorNotes.updatedAt))
    .limit(MAX_NOTE_FEED_ITEMS);
}

notes.get("/", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const rows = await loadActiveNotes(c.get("db"), actor.ap_id);
  return c.json({ notes: rows.map((row) => formatNote(row, actor.ap_id)) });
});

notes.post("/", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "JSON body required" }, 400);
  }

  const content = sanitizeContent((body as { content?: unknown }).content);
  if (!content) {
    return c.json(
      {
        error: `content must be 1-${MAX_NOTE_CONTENT_LENGTH} characters`,
      },
      400,
    );
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() +
      ttlHours((body as { expires_in_hours?: unknown }).expires_in_hours) *
        60 *
        60 *
        1000,
  ).toISOString();
  const db = c.get("db");

  await db
    .insert(actorNotes)
    .values({
      actorApId: actor.ap_id,
      content,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      deletedAt: null,
    })
    .onConflictDoUpdate({
      target: actorNotes.actorApId,
      set: {
        content,
        createdAt: now,
        updatedAt: now,
        expiresAt,
        deletedAt: null,
      },
    });

  return c.json(
    {
      note: formatNote(
        {
          actorApId: actor.ap_id,
          content,
          createdAt: now,
          updatedAt: now,
          expiresAt,
          preferredUsername: actor.preferred_username,
          name: actor.name,
          iconUrl: actor.icon_url,
        },
        actor.ap_id,
      ),
    },
    201,
  );
});

notes.delete("/me", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const now = new Date().toISOString();
  await c
    .get("db")
    .update(actorNotes)
    .set({ deletedAt: now, updatedAt: now, expiresAt: now })
    .where(eq(actorNotes.actorApId, actor.ap_id));

  return c.json({ success: true });
});

export default notes;
