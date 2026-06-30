import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors } from "../../../db/index.ts";
import { deriveContentTags } from "../../routes/posts/post-helpers.ts";

// DEEP round-2 #5: processMentions / deriveContentTags built an unchunked
// inArray over up to ~hundreds of mention tokens, exceeding D1's 100-bound-param
// ceiling (prod-only, invisible to the libsql test driver). The lookups are now
// chunked via chunkForInClause. This validates the chunk-then-merge logic: with
// MORE distinct local mentions than one chunk (D1_IN_CHUNK=90), EVERY mention is
// still resolved (i.e. the per-chunk result rows are correctly flattened and no
// row past the first chunk is dropped).

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

test("deriveContentTags resolves mentions across a chunk boundary (>90 distinct)", async () => {
  const db = await freshDb();
  const N = 95; // > D1_IN_CHUNK (90): spans two chunks
  const usernames = Array.from({ length: N }, (_, i) => `user${i}`);
  for (const u of usernames) {
    const apId = `${APP_URL}/ap/users/${u}`;
    await db.insert(actors).values({
      apId,
      type: "Person",
      preferredUsername: u,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem: "pub",
      privateKeyPem: "priv",
    });
  }

  const content = usernames.map((u) => `@${u}`).join(" ");
  const author = `${APP_URL}/ap/users/author`;
  const tags = await deriveContentTags(db, content, APP_URL, author);

  const mentionTags = tags.filter((t) => t.type === "Mention");
  // All 95 distinct local mentions resolve to a Mention tag — none dropped by a
  // chunk boundary.
  expect(mentionTags.length).toBe(N);
});
