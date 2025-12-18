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

  it("ignores unsupported format and parses opt-in flags", () => {
    const options = parseExportOptions({
      format: "activitypub",
      include_dm: true,
      media: true,
    });
    expect(options.format).toBe("json");
    expect(options.includeDm).toBe(true);
    expect(options.includeMedia).toBe(true);
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
  });
});

describe("collectMediaBundles", () => {
  it("collects media metadata", async () => {
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
    expect(result.json?.files[0]?.key).toBe("media-1");
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
    expect(json.ok).toBe(true);
    expect(json.data.attempt_count).toBe(0);
    expect(json.data.max_attempts).toBe(5);
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

describe("staged download endpoints", () => {
  it("GET /exports/:id/artifacts returns artifact list for completed export", async () => {
    mockStore.getExportRequest.mockResolvedValue({
      id: "exp-artifacts",
      user_id: "admin",
      format: "json",
      status: "completed",
      result_json: JSON.stringify({
        format: "json",
        generated_at: "2024-01-01T00:00:00.000Z",
        counts: {
          posts: 10,
          friends: 5,
          reactions: 20,
          bookmarks: 3,
          dm_threads: 2,
          dm_messages: 15,
          media_files: 8,
        },
        artifacts: {
          core: {
            key: "exports/admin/exp-artifacts/core.json",
            url: "/media/exports/admin/exp-artifacts/core.json",
            contentType: "application/json",
          },
          dm: {
            status: "completed",
            json: {
              key: "exports/admin/exp-artifacts/dm.json",
              url: "/media/exports/admin/exp-artifacts/dm.json",
              contentType: "application/json",
            },
          },
          media: {
            status: "completed",
            json: {
              key: "exports/admin/exp-artifacts/media.json",
              url: "/media/exports/admin/exp-artifacts/media.json",
              contentType: "application/json",
            },
          },
        },
      }),
    });

    const res = await exportsRoute.request(
      "/exports/exp-artifacts/artifacts",
      { method: "GET" },
      {} as any,
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.id).toBe("exp-artifacts");
    expect(json.data.artifacts).toHaveLength(3);
    expect(json.data.artifacts[0].key).toBe("core");
    expect(json.data.artifacts[1].key).toBe("dm-json");
    expect(json.data.artifacts[2].key).toBe("media-json");
  });

  it("GET /exports/:id/artifacts returns 400 for non-completed export", async () => {
    mockStore.getExportRequest.mockResolvedValue({
      id: "exp-pending",
      user_id: "admin",
      format: "json",
      status: "pending",
      result_json: "{}",
    });

    const res = await exportsRoute.request(
      "/exports/exp-pending/artifacts",
      { method: "GET" },
      {} as any,
    );

    expect(res.status).toBe(400);
  });

  it("GET /exports/:id/media-urls returns media file list", async () => {
    mockStore.getExportRequest.mockResolvedValue({
      id: "exp-media",
      user_id: "admin",
      format: "json",
      status: "completed",
      result_json: JSON.stringify({
        artifacts: {
          media: { status: "completed" },
        },
      }),
    });
    (mockStore as any).listMediaByUser = vi.fn().mockResolvedValue([
      {
        key: "user-uploads/admin/2024/01/01/file1.png",
        url: "/media/user-uploads/admin/2024/01/01/file1.png",
        content_type: "image/png",
        size: 12345,
        description: "Test image",
        created_at: "2024-01-01T00:00:00.000Z",
      },
    ]);

    const res = await exportsRoute.request(
      "/exports/exp-media/media-urls",
      { method: "GET" },
      { INSTANCE_DOMAIN: "example.com" } as any,
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.totalFiles).toBe(1);
    expect(json.data.files[0].filename).toBe("file1.png");
    expect(json.data.files[0].contentType).toBe("image/png");
  });

  it("GET /exports/:id/dm-threads returns DM thread list", async () => {
    mockStore.getExportRequest.mockResolvedValue({
      id: "exp-dm",
      user_id: "admin",
      format: "json",
      status: "completed",
      result_json: JSON.stringify({
        artifacts: {
          dm: { status: "completed" },
        },
      }),
    });
    (mockStore as any).listAllDmThreads = vi.fn().mockResolvedValue([
      {
        id: "thread-1",
        participants_json: JSON.stringify([
          "https://example.com/ap/users/admin",
          "https://remote.example/ap/users/bob",
        ]),
        created_at: "2024-01-01T00:00:00.000Z",
      },
    ]);

    const res = await exportsRoute.request(
      "/exports/exp-dm/dm-threads",
      { method: "GET" },
      { INSTANCE_DOMAIN: "example.com" } as any,
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.totalThreads).toBe(1);
    expect(json.data.threads[0].id).toBe("thread-1");
    expect(json.data.threads[0].participantCount).toBe(2);
  });
});
