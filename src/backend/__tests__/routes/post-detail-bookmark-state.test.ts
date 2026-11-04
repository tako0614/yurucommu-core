import { expect, test } from "bun:test";
import { Hono } from "hono";
import { actors, bookmarks, objects } from "../../../db/index.ts";
import type { Database } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import postRoutes from "../../routes/posts.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import { formatPost, type PostRow } from "../../routes/posts/transformers.ts";

const origin = "https://bookmark.test";
const actorId = (name: string) => `${origin}/ap/users/${name}`;
const postId = `${origin}/ap/objects/public-post`;

async function seed(db: Database) {
  for (const name of ["author", "viewer", "other"]) {
    const apId = actorId(name);
    await db.insert(actors).values({
      apId,
      type: "Person",
      preferredUsername: name,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem: "synthetic-public",
      privateKeyPem: "synthetic-private",
    });
  }
  for (const visibility of ["public", "direct"]) {
    await db.insert(objects).values({
      apId:
        visibility === "public" ? postId : `${origin}/ap/objects/private-post`,
      type: "Note",
      attributedTo: actorId("author"),
      content: "Bookmark route fixture",
      visibility,
      toJson: JSON.stringify(
        visibility === "public"
          ? ["https://www.w3.org/ns/activitystreams#Public"]
          : [],
      ),
      ccJson: "[]",
      published: "2026-11-04T00:00:00Z",
      isLocal: 1,
    });
  }
}

function appFor(db: Database, name?: string) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set(
      "actor",
      name
        ? ({
            ap_id: actorId(name),
            type: "Person",
            preferred_username: name,
            name: null,
            summary: null,
            icon_url: null,
            header_url: null,
            inbox: `${actorId(name)}/inbox`,
            outbox: `${actorId(name)}/outbox`,
            followers_url: `${actorId(name)}/followers`,
            following_url: `${actorId(name)}/following`,
            public_key_pem: "synthetic-public",
            private_key_pem: "synthetic-private",
            takos_user_id: null,
            follower_count: 0,
            following_count: 0,
            post_count: 0,
            is_private: 0,
            role: "member",
            created_at: "2026-11-04T00:00:00Z",
          } satisfies Actor)
        : null,
    );
    await next();
  });
  app.route("/api/posts", postRoutes);
  return app;
}

test("real post route preserves viewer-bound bookmark state through save, GET and remove", async () => {
  const fixture = await createTestDb();
  try {
    await seed(fixture.db);
    const app = appFor(fixture.db, "viewer"),
      other = appFor(fixture.db, "other"),
      anonymous = appFor(fixture.db);
    const env = { APP_URL: origin } as Env;
    const path = `${origin}/api/posts/${encodeURIComponent(postId)}`;
    const read = async (selected: typeof app) => {
      const response = await selected.request(path, undefined, env);
      expect(response.status).toBe(200);
      return (await response.json()) as { post: { bookmarked?: boolean } };
    };
    expect((await read(app)).post.bookmarked).toBe(false);
    const save = await app.request(`${path}/bookmark`, { method: "POST" }, env);
    expect(save.status).toBe(200);
    expect(await save.json()).toEqual({ success: true, bookmarked: true });
    expect((await read(app)).post.bookmarked).toBe(true);
    expect((await read(other)).post.bookmarked).toBe(false);
    expect((await read(anonymous)).post.bookmarked).toBe(false);
    const remove = await app.request(
      `${path}/bookmark`,
      { method: "DELETE" },
      env,
    );
    expect(remove.status).toBe(200);
    expect(await remove.json()).toEqual({ success: true, bookmarked: false });
    expect((await read(app)).post.bookmarked).toBe(false);
  } finally {
    await fixture.client.execute("PRAGMA shrink_memory");
  }
});

test("a bookmark never bypasses the existing private post read gate", async () => {
  const fixture = await createTestDb();
  try {
    await seed(fixture.db);
    const privateId = `${origin}/ap/objects/private-post`;
    await fixture.db
      .insert(bookmarks)
      .values({ actorApId: actorId("viewer"), objectApId: privateId });
    const response = await appFor(fixture.db, "viewer").request(
      `${origin}/api/posts/${encodeURIComponent(privateId)}`,
      undefined,
      { APP_URL: origin } as Env,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Post not found" });
  } finally {
    await fixture.client.execute("PRAGMA shrink_memory");
  }
});

test("formatter exposes only loaded flags and never carries a viewer flag to anonymous output", () => {
  const row: PostRow = {
    ap_id: postId,
    type: "Note",
    attributed_to: actorId("author"),
    author_username: "author",
    author_name: null,
    author_icon_url: null,
    content: "text",
    summary: null,
    attachments_json: "[]",
    in_reply_to: null,
    visibility: "public",
    community_ap_id: null,
    like_count: 0,
    reply_count: 0,
    announce_count: 0,
    published: "2026-11-04T00:00:00Z",
  };
  expect(formatPost(row, actorId("viewer"))).not.toHaveProperty("bookmarked");
  expect(
    formatPost({ ...row, bookmarked: 1 }, actorId("viewer")).bookmarked,
  ).toBe(true);
  expect(
    formatPost({ ...row, bookmarked: 0 }, actorId("viewer")).bookmarked,
  ).toBe(false);
  expect(formatPost({ ...row, bookmarked: true }).bookmarked).toBe(false);
});
