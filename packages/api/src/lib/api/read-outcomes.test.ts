import { expect, test } from "bun:test";
import { clearYurucommuApiTransport } from "../transport.ts";
import { fetchFollowers, fetchFollowing } from "./actors.ts";
import { fetchAlsoKnownAs } from "./account.ts";
import { fetchCommunities, fetchCommunityMessages } from "./communities.ts";
import {
  fetchDMContacts,
  fetchDMUnreadCount,
  fetchUserDMMessages,
} from "./dm.ts";
import { fetchReplies } from "./posts.ts";
import type { Post } from "../../types/index.ts";
import { fetchRecommendedUsers } from "./recommendations.ts";
import { searchActors, searchHashtag, searchRemote } from "./search.ts";

async function withResponse<T>(
  body: unknown,
  fn: () => Promise<T>,
  status = 200,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  clearYurucommuApiTransport();
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json(body, { status }),
    )) as unknown as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    clearYurucommuApiTransport();
  }
}

const sessionExpired = { error: "session expired" };
const reply = {
  ap_id: "https://example.com/ap/objects/reply-1",
  author: {
    ap_id: "https://example.com/ap/users/alice",
    preferred_username: "alice",
    name: "Alice",
    icon_url: null,
  },
} as Post;
const chatMessage = {
  id: "https://example.com/ap/objects/message-1",
  sender: {
    ap_id: "https://example.com/ap/users/alice",
    preferred_username: "alice",
    name: "Alice",
    icon_url: null,
  },
  content: "hello",
  created_at: "2026-10-03T00:00:00.000Z",
};

test("reply history surfaces missing-parent errors", async () => {
  await expect(
    withResponse(
      { error: "Post not found" },
      () => fetchReplies("https://example.com/ap/objects/missing"),
      404,
    ),
  ).rejects.toMatchObject({ name: "ApiError", status: 404 });
});

test("DM history and unread reads surface authentication errors", async () => {
  await expect(
    withResponse(
      sessionExpired,
      () => fetchUserDMMessages("https://example.com/ap/users/alice"),
      401,
    ),
  ).rejects.toMatchObject({ name: "ApiError", status: 401 });

  await expect(
    withResponse(sessionExpired, () => fetchDMUnreadCount(), 401),
  ).rejects.toMatchObject({ name: "ApiError", status: 401 });
});

test("reply, DM and community read envelopes reject missing required arrays", async () => {
  await expect(
    withResponse({}, () =>
      fetchReplies("https://example.com/ap/objects/post-1"),
    ),
  ).rejects.toMatchObject({ name: "InvalidApiResponseError" });

  await expect(
    withResponse(
      {
        conversation_id: null,
        has_more: false,
        partner_last_read_at: null,
      },
      () => fetchUserDMMessages("https://example.com/ap/users/alice"),
    ),
  ).rejects.toMatchObject({ name: "InvalidApiResponseError" });

  await expect(
    withResponse({ has_more: false, read_states: [] }, () =>
      fetchCommunityMessages("town"),
    ),
  ).rejects.toMatchObject({ name: "InvalidApiResponseError" });
});

test("read envelope arrays and unread counters reject wrong JSON types", async () => {
  await expect(
    withResponse({ replies: {}, has_more: false, next_cursor: null }, () =>
      fetchReplies("https://example.com/ap/objects/post-1"),
    ),
  ).rejects.toMatchObject({ name: "InvalidApiResponseError" });

  await expect(
    withResponse({ total: "0", dm: 0, community: 0 }, () =>
      fetchDMUnreadCount(),
    ),
  ).rejects.toMatchObject({ name: "InvalidApiResponseError" });

  await expect(
    withResponse(
      { mutual_followers: [], communities: {}, request_count: 0 },
      () => fetchDMContacts(),
    ),
  ).rejects.toMatchObject({ name: "InvalidApiResponseError" });
});

test("post and message arrays reject entities missing identity and author/sender records", async () => {
  await expect(
    withResponse(
      { replies: [{ ...reply, author: undefined }], has_more: false },
      () => fetchReplies("https://example.com/ap/objects/post-1"),
    ),
  ).rejects.toMatchObject({ name: "InvalidApiResponseError" });

  await expect(
    withResponse(
      {
        messages: [{ ...chatMessage, sender: undefined }],
        has_more: false,
        read_states: [],
      },
      () => fetchCommunityMessages("town"),
    ),
  ).rejects.toMatchObject({ name: "InvalidApiResponseError" });

  await expect(
    withResponse(
      {
        messages: [
          {
            id: "m1",
            sender: { preferred_username: "alice" },
            content: "hello",
            created_at: "2026-10-03T00:00:00.000Z",
          },
        ],
        conversation_id: "c1",
        has_more: false,
        partner_last_read_at: null,
      },
      () => fetchUserDMMessages("https://example.com/ap/users/alice"),
    ),
  ).rejects.toMatchObject({ name: "InvalidApiResponseError" });
});

test("community listing requires its list while keeping an empty list valid", async () => {
  await expect(
    withResponse({}, () => fetchCommunities()),
  ).rejects.toMatchObject({ name: "InvalidApiResponseError" });

  await expect(
    withResponse(
      {
        followers: [{ preferred_username: "alice" }],
        total: 1,
      },
      () => fetchFollowers("https://example.com/ap/users/alice"),
    ),
  ).rejects.toMatchObject({ name: "InvalidApiResponseError" });
  expect(
    await withResponse({ communities: [] }, () => fetchCommunities()),
  ).toEqual([]);
});

test("community listing surfaces failed reads", async () => {
  await expect(
    withResponse(sessionExpired, () => fetchCommunities(), 500),
  ).rejects.toMatchObject({ name: "ApiError", status: 500 });
});

test("follow hydration requires its list and count while allowing legacy page metadata omissions", async () => {
  await expect(
    withResponse({ total: 0, has_more: false }, () =>
      fetchFollowers("https://example.com/ap/users/alice"),
    ),
  ).rejects.toMatchObject({ name: "InvalidApiResponseError" });

  await expect(
    withResponse({ following: [], has_more: false }, () =>
      fetchFollowing("https://example.com/ap/users/alice"),
    ),
  ).rejects.toMatchObject({ name: "InvalidApiResponseError" });

  const page = await withResponse({ followers: [], total: 0 }, () =>
    fetchFollowers("https://example.com/ap/users/alice"),
  );
  expect(page).toEqual({ actors: [], total: 0, hasMore: false });
});

test("also-known-as hydration reads the wrapped actor for local and remote profiles", async () => {
  const aliases = ["https://local.example/ap/users/alice"];
  const local = await withResponse(
    {
      actor: {
        ap_id: "https://local.example/ap/users/alice",
        also_known_as: aliases,
      },
    },
    () => fetchAlsoKnownAs("alice"),
  );
  expect(local).toEqual(aliases);

  const remoteAliases = ["https://remote.example/users/alice"];
  const remote = await withResponse(
    {
      actor: {
        ap_id: "https://remote.example/users/alice",
        also_known_as: remoteAliases,
      },
    },
    () => fetchAlsoKnownAs("https://remote.example/users/alice"),
  );
  expect(remote).toEqual(remoteAliases);
});

test("also-known-as hydration rejects missing or malformed actor aliases and HTTP errors", async () => {
  await expect(
    withResponse({ also_known_as: ["https://example.com/alias"] }, () =>
      fetchAlsoKnownAs("alice"),
    ),
  ).rejects.toMatchObject({ name: "InvalidApiResponseError" });

  expect(
    await withResponse(
      { actor: { ap_id: "https://example.com/ap/users/alice" } },
      () => fetchAlsoKnownAs("alice"),
    ),
  ).toEqual([]);

  await expect(
    withResponse(
      {
        actor: {
          ap_id: "https://example.com/ap/users/alice",
          also_known_as: ["https://example.com/ok", 3],
        },
      },
      () => fetchAlsoKnownAs("alice"),
    ),
  ).rejects.toMatchObject({ name: "InvalidApiResponseError" });

  await expect(
    withResponse(
      { actor: { also_known_as: ["https://example.com/alias"] } },
      () => fetchAlsoKnownAs("alice"),
    ),
  ).rejects.toMatchObject({ name: "InvalidApiResponseError" });

  await expect(
    withResponse(sessionExpired, () => fetchAlsoKnownAs("alice"), 401),
  ).rejects.toMatchObject({ name: "ApiError", status: 401 });
});

test("search endpoints surface non-2xx responses instead of empty results", async () => {
  await expect(
    withResponse(sessionExpired, () => searchActors("alice"), 500),
  ).rejects.toMatchObject({ name: "ApiError", status: 500 });
  await expect(
    withResponse(sessionExpired, () => searchRemote("@alice@example.com"), 500),
  ).rejects.toMatchObject({ name: "ApiError", status: 500 });
  await expect(
    withResponse(sessionExpired, () => searchHashtag("updates"), 500),
  ).rejects.toMatchObject({ name: "ApiError", status: 500 });
});

test("search keeps genuine empty results", async () => {
  expect(await withResponse({ actors: [] }, () => searchActors(""))).toEqual({
    items: [],
    hasMore: false,
  });
  expect(
    await withResponse({ actors: [] }, () => searchRemote("not-a-handle")),
  ).toEqual([]);
  expect(
    await withResponse({ posts: [], total: 0 }, () => searchHashtag("")),
  ).toEqual({
    items: [],
    hasMore: false,
  });
});

test("recommendation endpoint preserves server-returned empty suggestions", async () => {
  expect(
    await withResponse({ users: [] }, () => fetchRecommendedUsers()),
  ).toEqual([]);
});
