import { describe, expect, it, vi, beforeEach } from "vitest";

const mockStore = {
  getExportRequest: vi.fn(),
  updateExportRequest: vi.fn(),
  listPendingExportRequests: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock("../middleware/auth", () => ({
  auth: async (c: any, next: () => Promise<void>) => {
    c.set("user", { id: "admin" });
    await next();
  },
}));

vi.mock("../data", () => ({
  makeData: () => mockStore,
}));

import exportsRoute, {
  buildCoreActivityPubPayload,
  collectDmBundles,
  collectMediaBundles,
  computeRetryDelayMs,
  normalizeAttempts,
  parseExportOptions,
  shouldBackoff,
} from "./exports";

beforeEach(() => {
  mockStore.getExportRequest.mockReset();
  mockStore.updateExportRequest.mockReset();
  mockStore.listPendingExportRequests.mockReset();
  mockStore.disconnect.mockReset();
  mockStore.updateExportRequest.mockResolvedValue(null);
});

describe("parseExportOptions", () => {
  it("defaults to json format and opts out of dm/media", () => {
    const options = parseExportOptions({});
    expect(options.format).toBe("json");
    expect(options.includeDm).toBe(false);
    expect(options.includeMedia).toBe(false);
  });

  it("parses activitypub format and opt-in flags", () => {
    const options = parseExportOptions({
      format: "activitypub",
      include_dm: true,
      media: true,
    });
    expect(options.format).toBe("activitypub");
    expect(options.includeDm).toBe(true);
    expect(options.includeMedia).toBe(true);
  });
});

describe("buildCoreActivityPubPayload", () => {
  it("resolves activitypub references and contexts", () => {
    const payload = buildCoreActivityPubPayload(
      {
        profile: { id: "alice", display_name: "Alice" },
        posts: [
          {
            id: "post-1",
            text: "hello world",
            created_at: "2024-01-01T00:00:00.000Z",
            broadcast_all: true,
            visible_to_friends: false,
            media_json: "[]",
          },
        ],
        friends: [
          {
            addressee_id: "@bob@remote.example",
            addressee_aliases: ["https://remote.example/ap/users/bob"],
          },
        ],
        reactions: [
          {
            id: "react-1",
            post_id: "object-1",
            user_id: "@carol@elsewhere.example",
            emoji: "👍",
            created_at: "2024-01-02T00:00:00.000Z",
          },
        ],
        bookmarks: [
          {
            id: "bm-1",
            post_id: "post-2",
            created_at: "2024-01-02T01:00:00.000Z",
          },
        ],
      } as any,
      "example.com",
    );

    const core: any = payload.payload;
    expect(Array.isArray(core["@context"])).toBe(true);
    expect(core.friends[0]).toBe("https://remote.example/ap/users/bob");
    expect(core.reactions[0].actor).toBe("https://elsewhere.example/ap/users/carol");
    expect(core.reactions[0].object).toBe("https://example.com/ap/objects/object-1");
    expect(core.bookmarks[0].object).toBe("https://example.com/ap/objects/post-2");
    expect(core.references.actors).toContain("https://elsewhere.example/ap/users/carol");
    expect(core.references.objects).toContain("https://example.com/ap/objects/object-1");
  });
});

describe("collectDmBundles", () => {
  it("returns only threads that include the requesting user", async () => {
    const store = {
      listAllDmThreads: vi.fn().mockResolvedValue([
        {
          id: "thread-1",
          participants_json: JSON.stringify([
            "https://example.com/ap/users/alice",
            "https://remote.example/ap/users/bob",
          ]),
          created_at: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "thread-2",
          participants_json: JSON.stringify([
            "https://remote.example/ap/users/charlie",
          ]),
          created_at: "2024-01-02T00:00:00.000Z",
        },
      ]),
      listDmMessages: vi.fn(async (threadId: string) => {
        if (threadId !== "thread-1") return [];
        return [
          {
            id: "msg-1",
            thread_id: "thread-1",
            author_id: "https://example.com/ap/users/alice",
            content_html: "<p>hello</p>",
            created_at: "2024-01-03T00:00:00.000Z",
          },
        ];
      }),
    } as any;

    const result = await collectDmBundles(store, "alice", "example.com");
    expect(result.counts.dmThreads).toBe(1);
    expect(result.counts.dmMessages).toBe(1);
    expect(result.json?.threads[0]?.messages[0]?.content_html).toContain("hello");
    expect(result.json?.threads[0]?.participants[0]).toBe("https://example.com/ap/users/alice");
    expect(result.json?.threads[0]?.raw_participants[0]).toContain("alice");
    expect(result.json?.threads[0]?.messages[0]?.actor).toBe("https://example.com/ap/users/alice");
    expect(
      result.activitypub?.threads[0]?.activities[0]?.object?.content,
    ).toContain("hello");
    expect(result.activitypub?.threads[0]?.participants[0]).toBe("https://example.com/ap/users/alice");
  });
});

describe("collectMediaBundles", () => {
  it("builds media activitypub documents with absolute urls", async () => {
    const store = {
      listMediaByUser: vi.fn().mockResolvedValue([
        {
          key: "media-1",
          url: "/media/user/uploads/file.png",
          description: "sample",
          content_type: "image/png",
          updated_at: "2024-01-04T00:00:00.000Z",
        },
      ]),
    } as any;

    const result = await collectMediaBundles(store, "alice", "example.com");
    expect(result.counts.media).toBe(1);
    expect(result.activitypub?.orderedItems[0]?.type).toBe("Image");
    expect(result.activitypub?.orderedItems[0]?.url).toContain("example.com");
    expect(store.listMediaByUser).toHaveBeenCalledWith("alice");
  });
});

describe("export retry backoff", () => {
  it("waits until the retry window passes after a failure", () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2024-01-01T00:00:00.000Z");
      vi.setSystemTime(now);

      const waiting = shouldBackoff({
        attempt_count: 1,
        processed_at: now.toISOString(),
      });
      expect(waiting.wait).toBe(true);

      const readyAt = computeRetryDelayMs(1) + 1000;
      vi.setSystemTime(new Date(now.getTime() + readyAt));
      const ready = shouldBackoff({
        attempt_count: 1,
        processed_at: now.toISOString(),
      });
      expect(ready.wait).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("normalizes attempts with sane defaults", () => {
    const normalized = normalizeAttempts({ attempt_count: -2, max_attempts: 0 });
    expect(normalized.attempts).toBe(0);
    expect(normalized.maxAttempts).toBeGreaterThan(0);
  });
});

describe("admin export retry endpoint", () => {
  it("resets attempts and clears processed_at for admin-triggered retries", async () => {
    mockStore.getExportRequest.mockResolvedValue({
      id: "exp-1",
      user_id: "alice",
      format: "json",
      status: "failed",
      attempt_count: 2,
      max_attempts: 3,
      processed_at: "2024-01-01T00:00:00.000Z",
      error_message: "boom",
      result_json: JSON.stringify({ options: { include_dm: false, include_media: false } }),
    });

    const res = await exportsRoute.request(
      "/admin/exports/exp-1/retry",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reset_attempts: true, max_attempts: 5 }),
      },
      { AUTH_USERNAME: "admin" } as any,
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.attempt_count).toBe(0);
    expect(json.max_attempts).toBe(5);
    expect(mockStore.updateExportRequest).toHaveBeenCalledWith("exp-1", {
      status: "pending",
      attempt_count: 0,
      max_attempts: 5,
      processed_at: null,
      download_url: null,
      error_message: null,
    });
  });

  it("blocks retries when attempts exceed the maximum and no override is provided", async () => {
    mockStore.getExportRequest.mockResolvedValue({
      id: "exp-2",
      user_id: "alice",
      format: "json",
      status: "failed",
      attempt_count: 3,
      max_attempts: 3,
      processed_at: "2024-01-01T00:00:00.000Z",
      error_message: "boom",
      result_json: JSON.stringify({ options: { include_dm: false, include_media: false } }),
    });

    const res = await exportsRoute.request(
      "/admin/exports/exp-2/retry",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
      { AUTH_USERNAME: "admin" } as any,
    );

    expect(res.status).toBe(409);
    expect(mockStore.updateExportRequest).not.toHaveBeenCalled();
  });
});
