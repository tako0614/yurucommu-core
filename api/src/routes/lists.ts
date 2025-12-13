import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import {
  ok,
  fail,
  releaseStore,
  uuid,
  nowISO,
  requireInstanceDomain,
  getActorUri,
  webfingerLookup,
  getOrFetchActor,
} from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { makeData } from "../data";
import { ErrorCodes } from "../lib/error-codes";

const lists = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Helper to check list access
async function assertListAccess(
  store: ReturnType<typeof makeData>,
  listId: string,
  viewerId: string,
) {
  const list = await store.getList(listId);
  if (!list) {
    return {
      status: 404,
      code: ErrorCodes.NOT_FOUND,
      message: "List not found",
      details: { listId },
    } as const;
  }
  if (!list.is_public && list.owner_id !== viewerId) {
    return {
      status: 403,
      code: ErrorCodes.FORBIDDEN,
      message: "Forbidden",
      details: { listId },
    } as const;
  }
  return { list };
}

async function resolveUserIdToActor(
  store: ReturnType<typeof makeData>,
  env: any,
  raw: string,
): Promise<{ id: string; actorUri: string } | null> {
  const input = String(raw || "").trim();
  if (!input) return null;
  const instanceDomain = requireInstanceDomain(env);

  // Local user first
  const local = await store.getUser(input).catch(() => null);
  if (local) {
    const actorUri = getActorUri(local.id, instanceDomain);
    return { id: local.id, actorUri };
  }

  // Full actor URI
  if (input.startsWith("http://") || input.startsWith("https://")) {
    const actorUri = input;
    const actor = await getOrFetchActor(actorUri, env as any).catch(() => null);
    if (!actor) return null;
    const handle = actor.preferredUsername || actorUri.split("/").pop() || "unknown";
    const domain = new URL(actorUri).hostname.toLowerCase();
    return { id: `@${handle}@${domain}`, actorUri };
  }

  // acct-style @user@domain
  const acct = input.replace(/^@+/, "");
  if (acct.includes("@")) {
    const actorUri = await webfingerLookup(acct, fetch).catch(() => null);
    if (!actorUri) return null;
    const actor = await getOrFetchActor(actorUri, env as any).catch(() => null);
    if (!actor) return null;
    const handle = actor.preferredUsername || acct.split("@")[0] || acct;
    const domain = new URL(actorUri).hostname.toLowerCase();
    return { id: `@${handle}@${domain}`, actorUri };
  }

  return null;
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
    const { list, status, code, message, details } = await assertListAccess(
      store,
      c.req.param("id"),
      user.id,
    );
    if (!list) return fail(c, message ?? "Forbidden", status ?? 403, { code, details });
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
    if (!list) return fail(c, "List not found", 404, { code: ErrorCodes.NOT_FOUND, details: { listId } });
    if (list.owner_id !== user.id) return fail(c, "Forbidden", 403, { code: ErrorCodes.FORBIDDEN, details: { listId } });
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
    if (!list) return fail(c, "List not found", 404, { code: ErrorCodes.NOT_FOUND, details: { listId } });
    if (list.owner_id !== user.id) return fail(c, "Forbidden", 403, { code: ErrorCodes.FORBIDDEN, details: { listId } });
    const body = (await c.req.json().catch(() => ({}))) as any;
    const targetUserId = String(body.user_id || "").trim();
    if (!targetUserId) return fail(c, "user_id is required", 400);

    const resolved = await resolveUserIdToActor(store, c.env, targetUserId);
    if (!resolved) return fail(c, "User not found", 404, { code: ErrorCodes.USER_NOT_FOUND, details: { userId: targetUserId } });

    await store.addListMember({
      list_id: listId,
      user_id: resolved.id,
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
    if (!list) return fail(c, "List not found", 404, { code: ErrorCodes.NOT_FOUND, details: { listId } });
    if (list.owner_id !== user.id) return fail(c, "Forbidden", 403, { code: ErrorCodes.FORBIDDEN, details: { listId } });
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
    const { list, status, code, message, details } = await assertListAccess(
      store,
      c.req.param("id"),
      user.id,
    );
    if (!list) return fail(c, message ?? "Forbidden", status ?? 403, { code, details });
    const members = await store.listMembersByList(list.id);
    const authorIds = Array.from(
      new Set<string>([list.owner_id, ...members.map((m: any) => m.user_id)]),
    );
    const posts = await store.listPostsByAuthors(authorIds, false);
    // Filter visibility for viewer - get mutual follows (friends)
    const friends = await store.listFriends(user.id);
    const friendSet = new Set<string>();
    for (const f of friends) {
      const addAll = (value: string | null | undefined, aliases?: any) => {
        if (value) friendSet.add(value);
        if (Array.isArray(aliases)) {
          for (const alias of aliases) {
            if (alias) friendSet.add(alias);
          }
        }
      };
      if (f.requester_id === user.id) {
        addAll(f.addressee_id, f.addressee_aliases);
      }
      if (f.addressee_id === user.id) {
        addAll(f.requester_id, f.requester_aliases);
      }
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
