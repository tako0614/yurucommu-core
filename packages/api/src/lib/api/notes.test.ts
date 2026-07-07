import { expect, test } from "bun:test";
import { clearYurucommuApiTransport } from "../transport.ts";
import type { ActorNote } from "../../types/index.ts";
import { createNote, deleteMyNote, fetchNotes } from "./notes.ts";

function makeNote(overrides: Partial<ActorNote> = {}): ActorNote {
  return {
    actor: {
      ap_id: "https://example.com/ap/users/alice",
      username: "",
      preferred_username: "alice",
      name: "Alice",
      icon_url: null,
    },
    content: "shipping notes",
    created_at: "2026-07-05T00:00:00.000Z",
    updated_at: "2026-07-05T00:00:00.000Z",
    expires_at: "2026-07-06T00:00:00.000Z",
    is_mine: false,
    ...overrides,
  };
}

async function withMockFetch<T>(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  clearYurucommuApiTransport();
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(input, init))) as typeof fetch;

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    clearYurucommuApiTransport();
  }
}

test("fetchNotes reads notes and normalizes actor usernames", async () => {
  const result = await withMockFetch(
    () =>
      new Response(JSON.stringify({ notes: [makeNote()] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    () => fetchNotes(),
  );

  expect(result.map((note) => note.actor.username)).toEqual([
    "alice@example.com",
  ]);
});

test("createNote posts content and reads the wrapped note response", async () => {
  const note = makeNote({ content: "hello" });
  const calls: Array<{ url: string; method?: string; body?: string }> = [];

  const result = await withMockFetch(
    (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method,
        body: String(init?.body ?? ""),
      });
      return new Response(JSON.stringify({ note }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    },
    () => createNote({ content: "hello", expires_in_hours: 24 }),
  );

  expect(result.content).toBe("hello");
  expect(calls).toEqual([
    {
      url: "/api/notes",
      method: "POST",
      body: JSON.stringify({ content: "hello", expires_in_hours: 24 }),
    },
  ]);
});

test("deleteMyNote deletes the current actor note", async () => {
  const calls: Array<{ url: string; method?: string }> = [];

  await withMockFetch(
    (input, init) => {
      calls.push({ url: String(input), method: init?.method });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    () => deleteMyNote(),
  );

  expect(calls).toEqual([{ url: "/api/notes/me", method: "DELETE" }]);
});
