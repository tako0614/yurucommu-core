import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RETRY_AFTER_MS,
  createBackoffHint,
  formatSseMessage,
  getInitialCursor,
  parseCursor,
  parseTopics,
  pollRealtime,
} from "./realtime";

describe("parseTopics", () => {
  it("enables home and notifications by default", () => {
    const parsed = parseTopics(null);
    expect(parsed.home).toBe(true);
    expect(parsed.notifications).toBe(true);
    expect(parsed.userIds.size).toBe(0);
  });

  it("parses explicit topics and user ids", () => {
    const parsed = parseTopics("notifications,user:alice");
    expect(parsed.home).toBe(false);
    expect(parsed.notifications).toBe(true);
    expect(parsed.userIds.has("alice")).toBe(true);
  });
});

describe("cursor parsing", () => {
  it("prefers cursor param, then since and header", () => {
    const url = new URL("https://example.com/ws?cursor=1700000000000");
    const sinceUrl = new URL("https://example.com/ws?since=2024-01-01T00:00:00Z");

    expect(getInitialCursor(url)).toBe(1700000000000);
    expect(getInitialCursor(sinceUrl)).toBe(Date.parse("2024-01-01T00:00:00Z"));
    expect(parseCursor("1700000001234:post")).toBe(1700000001234);
  });
});

describe("backoff helpers", () => {
  it("creates a backoff hint with default retry", () => {
    const hint = createBackoffHint("poll_failed");
    expect(hint.reason).toBe("poll_failed");
    expect(hint.retry_after_ms).toBe(DEFAULT_RETRY_AFTER_MS);
  });

  it("formats SSE messages with retry-after and id", () => {
    const payload = formatSseMessage(
      "backoff",
      { retry_after_ms: 7500 },
      "cursor-1",
      7500,
    );
    expect(payload).toContain("id: cursor-1");
    expect(payload).toContain("retry: 7500");
    expect(payload).toContain("event: backoff");
    expect(payload).toContain("\"retry_after_ms\":7500");
  });
});

describe("pollRealtime", () => {
  it("emits post and notification events and advances cursor", async () => {
    const now = Date.now();
    const postCreated = new Date(now - 500);
    const notificationCreated = new Date(now - 200);
    const cursor = { value: now - 1000 };
    const events: Array<{
      event: string;
      payload: any;
      cursorId: string;
      ts: number;
    }> = [];

    const store = {
      listGlobalPostsSince: vi.fn().mockResolvedValue([
        { id: "post-1", author_id: "friend1", created_at: postCreated },
      ]),
      listNotificationsSince: vi.fn().mockResolvedValue([
        { id: "n-1", created_at: notificationCreated },
      ]),
      countUnreadNotifications: vi.fn().mockResolvedValue(2),
    };

    await pollRealtime(
      {
        store: store as any,
        userId: "me",
        topics: {
          home: true,
          notifications: true,
          userIds: new Set<string>(),
        },
        friendIds: new Set<string>(["friend1"]),
        cursor,
      },
      (event, payload, cursorId, ts) => {
        events.push({ event, payload, cursorId, ts });
      },
    );

    expect(store.listGlobalPostsSince).toHaveBeenCalled();
    expect(store.listNotificationsSince).toHaveBeenCalled();
    const postEvent = events.find((e) => e.event === "post");
    expect(postEvent?.payload.targets).toContain("home");
    const notificationEvent = events.find((e) => e.event === "notification");
    expect(notificationEvent?.payload.unread_count).toBe(2);
    expect(cursor.value).toBe(notificationCreated.getTime());
  });
});
