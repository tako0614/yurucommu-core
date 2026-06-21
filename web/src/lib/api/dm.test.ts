import { assertEquals } from "#test/assert";
import { test } from "bun:test";
import { clearYurucommuFrontendPlugin } from "../plugin.ts";
import type { DMMessage } from "../../types/index.ts";
import { fetchUserDMMessages } from "./dm.ts";

function makeMessage(id: string): DMMessage {
  return {
    id,
    sender: {
      ap_id: "https://example.com/ap/users/alice",
      username: "alice@example.com",
      preferred_username: "alice",
      name: "Alice",
      icon_url: null,
    },
    content: "hi",
    attachments: [],
    created_at: "2026-01-01T00:00:00.000Z",
  } as unknown as DMMessage;
}

async function withMockFetch<T>(
  responseBody: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  clearYurucommuFrontendPlugin();
  globalThis.fetch = ((_input: RequestInfo | URL) =>
    Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    clearYurucommuFrontendPlugin();
  }
}

// Regression: the DM thread's "load older" affordance depends on the client
// surfacing the server's `has_more` flag (it was previously discarded).
test("fetchUserDMMessages surfaces has_more as hasMore and maps messages", async () => {
  const result = await withMockFetch(
    {
      messages: [makeMessage("m1")],
      conversation_id: "conv-1",
      has_more: true,
    },
    () => fetchUserDMMessages("https://example.com/ap/users/alice"),
  );

  assertEquals(
    result.messages.map((m) => m.id),
    ["m1"],
  );
  assertEquals(result.conversation_id, "conv-1");
  assertEquals(result.hasMore, true);
});

test("fetchUserDMMessages defaults hasMore to false when the server omits it", async () => {
  const result = await withMockFetch({ messages: [] }, () =>
    fetchUserDMMessages("https://example.com/ap/users/alice"),
  );

  assertEquals(result.messages, []);
  assertEquals(result.hasMore, false);
});
