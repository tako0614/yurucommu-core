import { expect, test } from "bun:test";
import type { Notification } from "../../types/index.ts";
import {
  resolveNotificationTarget,
  safeNotificationPath,
} from "./notification-target.ts";
import { normalizeNotification } from "./normalize.ts";

function notif(overrides: Partial<Notification>): Notification {
  return {
    id: "n1",
    type: "like",
    actor: {
      ap_id: "https://example.com/ap/users/alice",
      username: "alice@example.com",
      preferred_username: "alice",
      name: "Alice",
      icon_url: null,
    },
    object_ap_id: null,
    read: false,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Notification;
}

test("safeNotificationPath rejects non-same-origin and control-char paths", () => {
  expect(safeNotificationPath("/post/x")).toBe("/post/x");
  expect(safeNotificationPath("//evil.example")).toBeNull();
  expect(safeNotificationPath("https://evil.example")).toBeNull();
  expect(safeNotificationPath("/a\\b")).toBeNull();
  expect(safeNotificationPath("/a\u0000b")).toBeNull();
  expect(safeNotificationPath("")).toBeNull();
  expect(safeNotificationPath(null)).toBeNull();
  expect(safeNotificationPath(undefined)).toBeNull();
});

test("resolveNotificationTarget honors a safe server-provided target", () => {
  const target = resolveNotificationTarget(
    notif({
      type: "like",
      object_ap_id: "https://example.com/ap/objects/1",
      target_kind: "post",
      target_id: "https://example.com/ap/objects/1",
      target_url: "/post/custom",
    }),
  );
  expect(target).toEqual({
    target_kind: "post",
    target_id: "https://example.com/ap/objects/1",
    target_url: "/post/custom",
  });
});

test("resolveNotificationTarget re-derives when target_url is unsafe", () => {
  const target = resolveNotificationTarget(
    notif({
      type: "like",
      object_ap_id: "https://example.com/ap/objects/1",
      target_kind: "post",
      target_url: "//evil.example",
    }),
  );
  expect(target.target_kind).toBe("post");
  expect(target.target_url).toBe(
    `/post/${encodeURIComponent("https://example.com/ap/objects/1")}`,
  );
});

test("resolveNotificationTarget synthesizes for a pre-3.2.0 server (no target_*)", () => {
  expect(resolveNotificationTarget(notif({ type: "follow" }))).toEqual({
    target_kind: "profile",
    target_id: "https://example.com/ap/users/alice",
    target_url: `/profile/${encodeURIComponent("https://example.com/ap/users/alice")}`,
  });
  expect(
    resolveNotificationTarget(
      notif({
        type: "like",
        object_ap_id: "https://example.com/ap/stories/9",
      }),
    ),
  ).toEqual({
    target_kind: "story",
    target_id: "https://example.com/ap/stories/9",
    target_url: `/?story=${encodeURIComponent("https://example.com/ap/stories/9")}`,
  });
  expect(
    resolveNotificationTarget(notif({ type: "mention", object_ap_id: null })),
  ).toEqual({
    target_kind: "notifications",
    target_id: null,
    target_url: "/notifications",
  });
});

test("normalizeNotification fills a safe target for a legacy payload", () => {
  const normalized = normalizeNotification(
    notif({
      type: "reply",
      object_ap_id: "https://example.com/ap/objects/42",
    }),
  );
  expect(normalized.target_kind).toBe("post");
  expect(normalized.target_id).toBe("https://example.com/ap/objects/42");
  expect(normalized.target_url).toBe(
    `/post/${encodeURIComponent("https://example.com/ap/objects/42")}`,
  );
});
