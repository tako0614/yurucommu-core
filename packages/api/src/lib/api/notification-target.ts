import type {
  Notification,
  NotificationTargetKind,
} from "../../types/index.ts";

export interface NotificationTarget {
  readonly target_kind: NotificationTargetKind;
  readonly target_id: string | null;
  /**
   * Same-origin in-app path shaped for the yurucommu web client's routing.
   * Other clients should prefer `target_kind` + `target_id` and build their own
   * path. Never treat this as an external URL.
   */
  readonly target_url: string;
}

/** True if the string contains any C0 control character (0x00-0x1f). */
function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 0x20) return true;
  }
  return false;
}

/**
 * Guard an in-app navigation path against open-redirect / protocol-relative /
 * control-character abuse. Returns the value only if it is a plain same-origin
 * absolute path (`/...`, not `//...`), else null. Promoted from the yurucommu
 * and yurume web clients, which each carried an identical copy.
 */
export function safeNotificationPath(
  value: string | null | undefined,
): string | null {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    hasControlChar(value)
  ) {
    return null;
  }
  return value;
}

function isStoryNotification(notification: Notification): boolean {
  return (
    notification.target_kind === "story" ||
    !!notification.object_ap_id?.includes("/ap/stories/")
  );
}

/**
 * Resolve the navigation target for a notification. Prefers the server-provided
 * `target_*` fields (3.2.0+) after re-validating `target_url`; when a server
 * older than 3.2.0 omitted them, synthesizes the same mapping the server uses
 * from `type` + `object_ap_id`. Always returns a safe same-origin path.
 */
export function resolveNotificationTarget(
  notification: Notification,
): NotificationTarget {
  const declaredKind = notification.target_kind;
  const declaredUrl = safeNotificationPath(notification.target_url);
  if (declaredKind && declaredUrl) {
    return {
      target_kind: declaredKind,
      target_id: notification.target_id ?? null,
      target_url: declaredUrl,
    };
  }

  if (
    notification.type === "follow" ||
    notification.type === "follow_request"
  ) {
    const actorApId = notification.actor?.ap_id ?? null;
    return {
      target_kind: "profile",
      target_id: actorApId,
      target_url: actorApId
        ? `/profile/${encodeURIComponent(actorApId)}`
        : "/notifications",
    };
  }

  const objectApId = notification.object_ap_id;
  if (objectApId && isStoryNotification(notification)) {
    return {
      target_kind: "story",
      target_id: objectApId,
      target_url: `/?story=${encodeURIComponent(objectApId)}`,
    };
  }
  if (objectApId) {
    return {
      target_kind: "post",
      target_id: objectApId,
      target_url: `/post/${encodeURIComponent(objectApId)}`,
    };
  }
  return {
    target_kind: "notifications",
    target_id: null,
    target_url: "/notifications",
  };
}
