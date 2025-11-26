import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import {
  ok,
  fail,
  releaseStore,
  uuid,
  nowISO,
} from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { makeData } from "../data";

const lists = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Helper to check list access
async function assertListAccess(
  store: ReturnType<typeof makeData>,
  listId: string,
  viewerId: string,
) {
  const list = await store.getList(listId);
  if (!list) {
    return { status: 404, message: "list not found" } as const;
  }
  if (!list.is_public && list.owner_id !== viewerId) {
    return { status: 403, message: "forbidden" } as const;
  }
  return { list };
}

// POST /lists
lists.post("/lists", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const body = (await c.req.json().catch(() => ({}))) as any;
    const name = String(body.name || "").trim();
    if (!name) return fail(c, "name is required", 400);
    const description = String(body.description || "");
    const is_public = !!body.is_public;
    const list = await store.createList({
      id: uuid(),
      owner_id: user.id,
      name,
      description,
      is_public,
      created_at: nowISO(),
      updated_at: nowISO(),
    });
    return ok(c, list, 201);
  } finally {
    await releaseStore(store);
  }
});

// GET /lists (owned)
lists.get("/lists", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const list = await store.listListsByOwner(user.id);
    return ok(c, list);
  } finally {
    await releaseStore(store);
  }
});

// GET /lists/:id
lists.get("/lists/:id", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const { list, status, message } = await assertListAccess(
      store,
      c.req.param("id"),
      user.id,
    );
    if (!list) return fail(c, message ?? "forbidden", status ?? 403);
    const members = await store.listMembersByList(list.id);
    return ok(c, { ...list, members });
  } finally {
    await releaseStore(store);
  }
});

// PATCH /lists/:id
lists.patch("/lists/:id", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const listId = c.req.param("id");
    const list = await store.getList(listId);
    if (!list) return fail(c, "list not found", 404);
    if (list.owner_id !== user.id) return fail(c, "forbidden", 403);
    const body = (await c.req.json().catch(() => ({}))) as any;
    const fields: any = {};
    if (body.name !== undefined) fields.name = String(body.name || "");
    if (body.description !== undefined) fields.description = String(body.description || "");
    if (body.is_public !== undefined) fields.is_public = !!body.is_public;
    if (!Object.keys(fields).length) return ok(c, list);
    fields.updated_at = nowISO();
    const updated = await store.updateList(listId, fields);
    return ok(c, updated);
  } finally {
    await releaseStore(store);
  }
});

// POST /lists/:id/members
lists.post("/lists/:id/members", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const listId = c.req.param("id");
    const list = await store.getList(listId);
    if (!list) return fail(c, "list not found", 404);
    if (list.owner_id !== user.id) return fail(c, "forbidden", 403);
    const body = (await c.req.json().catch(() => ({}))) as any;
    const targetUserId = String(body.user_id || "").trim();
    if (!targetUserId) return fail(c, "user_id is required", 400);
    const targetUser = await store.getUser(targetUserId);
    if (!targetUser) return fail(c, "user not found", 404);
    await store.addListMember({
      list_id: listId,
      user_id: targetUserId,
      added_at: nowISO(),
    });
    const members = await store.listMembersByList(listId);
    return ok(c, { ...list, members });
  } finally {
    await releaseStore(store);
  }
});

// DELETE /lists/:id/members/:userId
lists.delete("/lists/:id/members/:userId", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const listId = c.req.param("id");
    const list = await store.getList(listId);
    if (!list) return fail(c, "list not found", 404);
    if (list.owner_id !== user.id) return fail(c, "forbidden", 403);
    const targetUserId = c.req.param("userId");
    await store.removeListMember(listId, targetUserId);
    const members = await store.listMembersByList(listId);
    return ok(c, { ...list, members });
  } finally {
    await releaseStore(store);
  }
});

// GET /lists/:id/timeline
lists.get("/lists/:id/timeline", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const { list, status, message } = await assertListAccess(
      store,
      c.req.param("id"),
      user.id,
    );
    if (!list) return fail(c, message ?? "forbidden", status ?? 403);
    const members = await store.listMembersByList(list.id);
    const authorIds = Array.from(
      new Set<string>([list.owner_id, ...members.map((m: any) => m.user_id)]),
    );
    const posts = await store.listPostsByAuthors(authorIds, false);
    // Filter visibility for viewer
    const friendships = await store.listFriendships(user.id, "accepted");
    const friendSet = new Set<string>();
    for (const f of friendships) {
      if (f.requester_id === user.id && f.addressee_id) friendSet.add(f.addressee_id);
      if (f.addressee_id === user.id && f.requester_id) friendSet.add(f.requester_id);
    }
    const visible = posts.filter((post: any) => {
      if (post.author_id === user.id) return true;
      if (post.author_id === list.owner_id) return true;
      if (post.visible_to_friends === undefined || post.visible_to_friends) {
        return friendSet.has(post.author_id);
      }
      return false;
    });
    visible.sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1));
    return ok(c, visible);
  } finally {
    await releaseStore(store);
  }
});

export default lists;
