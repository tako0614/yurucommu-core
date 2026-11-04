import { expect, test } from "bun:test";
import { Hono } from "hono";
import { actors, actorCache, objects } from "../../../db/index.ts";
import type { Database } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import posts from "../../routes/posts.ts";
import {
  deriveContentTags,
  resolvePostMentions,
} from "../../routes/posts/post-helpers.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const origin = "https://reply.fixture.test";
const id = (name: string) => `${origin}/ap/users/${name}`;
async function seed(db: Database, name: string) {
  const apId = id(name);
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: name,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "synthetic",
    privateKeyPem: "synthetic",
  });
}
const actor = (name: string): Actor => ({
  ap_id: id(name),
  type: "Person",
  preferred_username: name,
  name: null,
  summary: null,
  icon_url: null,
  header_url: null,
  inbox: `${id(name)}/inbox`,
  outbox: `${id(name)}/outbox`,
  followers_url: `${id(name)}/followers`,
  following_url: `${id(name)}/following`,
  public_key_pem: "synthetic",
  private_key_pem: "synthetic",
  takos_user_id: null,
  follower_count: 0,
  following_count: 0,
  post_count: 0,
  is_private: 0,
  role: "member",
  created_at: "2026-11-04T00:00:00Z",
});

test("canonical local qualified and mixed-case host mentions resolve one local recipient", async () => {
  const f = await createTestDb();
  await seed(f.db, "author");
  await seed(f.db, "sender");
  const result = await resolvePostMentions(f.db, {
    content: "@author@reply.fixture.test @author@REPLY.FIXTURE.TEST",
    actorApId: id("sender"),
    baseUrl: origin,
  });
  expect(result.mentionedActorApIds).toEqual([id("author")]);
  expect(result.remoteMentionedActorApIds).toEqual([]);
  expect(result.tags.filter((tag) => tag.type === "Mention")).toHaveLength(1);
  expect(result.failures).toEqual([]);
  expect(
    await deriveContentTags(
      f.db,
      "@author@reply.fixture.test @author@REPLY.FIXTURE.TEST",
      origin,
      id("sender"),
    ),
  ).toEqual(result.tags);
});

test("a qualified local direct reply is actually readable by its explicit recipient", async () => {
  const f = await createTestDb();
  for (const name of ["author", "sender", "outsider"]) await seed(f.db, name);
  const parent = `${origin}/ap/objects/parent`;
  await f.db.insert(objects).values({
    apId: parent,
    type: "Note",
    attributedTo: id("author"),
    content: "parent",
    visibility: "public",
    toJson: JSON.stringify(["https://www.w3.org/ns/activitystreams#Public"]),
    ccJson: "[]",
    published: "2026-11-04T00:00:00Z",
    isLocal: 1,
  });
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", f.db);
    c.set("actor", actor(c.req.header("x-test-viewer") ?? "sender"));
    await next();
  });
  app.route("/api/posts", posts);
  const env = { APP_URL: origin } as Env;
  const created = await app.request(
    `${origin}/api/posts`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "@author@reply.fixture.test explicit reply",
        visibility: "direct",
        in_reply_to: parent,
      }),
    },
    env,
  );
  expect(created.status).toBe(200);
  const value = (await created.json()) as { post: { ap_id: string } };
  const row = await f.db.query.objects.findFirst({
    where: (obj, { eq }) => eq(obj.apId, value.post.ap_id),
  });
  expect(row?.inReplyTo).toBe(parent);
  expect(JSON.parse(row?.ccJson ?? "[]")).toContain(id("author"));
  const read = async (name: string) =>
    app.request(
      `${origin}/api/posts/${encodeURIComponent(value.post.ap_id)}`,
      { headers: { "x-test-viewer": name } },
      env,
    );
  expect((await read("author")).status).toBe(200);
  expect((await read("outsider")).status).toBe(404);
  for (const patch of [
    { content: "@author@reply.fixture.test edited reply" },
    { summary: "edited summary" },
  ]) {
    const edited = await app.request(
      `${origin}/api/posts/${encodeURIComponent(value.post.ap_id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      },
      env,
    );
    expect(edited.status).toBe(200);
  }
  const edited = await f.db.query.objects.findFirst({
    where: (obj, { eq }) => eq(obj.apId, value.post.ap_id),
  });
  expect(JSON.parse(edited?.tagsJson ?? "[]")).toContainEqual({
    type: "Mention",
    href: id("author"),
    name: "@author@reply.fixture.test",
  });
  const updates = await f.db.query.activities.findMany({
    where: (activity, { eq }) => eq(activity.type, "Update"),
  });
  expect(updates).toHaveLength(2);
  for (const update of updates)
    expect(JSON.parse(update.rawJson).object.tag).toContainEqual({
      type: "Mention",
      href: id("author"),
      name: "@author@reply.fixture.test",
    });
});

test("remote and lookalike hosts keep their existing exact-host cached resolution", async () => {
  const f = await createTestDb();
  await seed(f.db, "author");
  await seed(f.db, "sender");
  const remote = "https://reply.fixture.test.evil/users/author";
  await f.db.insert(actorCache).values({
    apId: remote,
    preferredUsername: "author",
    inbox: `${remote}/inbox`,
    rawJson: JSON.stringify({
      id: remote,
      type: "Person",
      preferredUsername: "author",
    }),
  });
  const local = await resolvePostMentions(f.db, {
    content: "@author@reply.fixture.test",
    actorApId: id("sender"),
    baseUrl: origin,
  });
  expect(local.mentionedActorApIds).toEqual([id("author")]);
  const other = await resolvePostMentions(f.db, {
    content: "@author@reply.fixture.test.evil",
    actorApId: id("sender"),
    baseUrl: origin,
  });
  expect(other.mentionedActorApIds).toEqual([remote]);
  expect(other.remoteMentionedActorApIds).toEqual([remote]);
  const missing = await resolvePostMentions(f.db, {
    content: "no mention",
    actorApId: id("sender"),
    baseUrl: origin,
  });
  expect(missing.mentionedActorApIds).toEqual([]);
});

test("qualified-local username lookup retains D1's bounded query groups", async () => {
  const f = await createTestDb();
  await seed(f.db, "sender");
  const names = Array.from({ length: 130 }, (_, i) => `recipient${i}`);
  for (const name of names) await seed(f.db, name);
  const result = await resolvePostMentions(f.db, {
    content: names.map((name) => `@${name}@reply.fixture.test`).join(" "),
    actorApId: id("sender"),
    baseUrl: origin,
  });
  expect(new Set(result.mentionedActorApIds)).toEqual(new Set(names.map(id)));
  expect(result.remoteMentionedActorApIds).toEqual([]);
});
