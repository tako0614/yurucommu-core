import {
  Actor,
  ActorStories,
  ActorNote,
  Notification,
  Post,
  Story,
} from "../../types/index.ts";
import { resolveNotificationTarget } from "./notification-target.ts";

type ActorLike = {
  ap_id: string;
  username?: string;
  preferred_username?: string | null;
};

type NormalizedActor<T extends ActorLike> = Omit<
  T,
  "username" | "preferred_username"
> & {
  username: string;
  preferred_username: string;
};

function formatUsernameFromApId(
  apId: string,
  preferred?: string | null,
): string | null {
  try {
    const url = new URL(apId);
    if (preferred) return `${preferred}@${url.host}`;
    const match = url.pathname.match(/\/(users|groups)\/([^/]+)\/?$/u);
    if (match) return `${match[2]}@${url.host}`;
  } catch {
    // Ignore malformed URLs and fallback to existing fields.
  }
  return null;
}

export function normalizeActor<T extends ActorLike>(
  actor: T,
): NormalizedActor<T> {
  const rawUsername = actor.username?.trim();
  const declaredPreferred = actor.preferred_username?.trim() || null;
  const rawSeparator = rawUsername?.lastIndexOf("@") ?? -1;
  const rebasedRawUsername =
    declaredPreferred &&
    rawUsername &&
    !rawUsername.includes("://") &&
    rawSeparator > 0 &&
    rawSeparator < rawUsername.length - 1
      ? `${declaredPreferred}@${rawUsername.slice(rawSeparator + 1)}`
      : null;
  const formatted =
    rebasedRawUsername ||
    (declaredPreferred
      ? formatUsernameFromApId(actor.ap_id, declaredPreferred)
      : rawUsername) ||
    formatUsernameFromApId(actor.ap_id) ||
    declaredPreferred ||
    actor.username ||
    actor.ap_id;
  const preferred =
    declaredPreferred ||
    (formatted.includes("@") ? formatted.split("@")[0] : formatted);

  return {
    ...actor,
    username: formatted,
    preferred_username: preferred,
  };
}

export const normalizePost = (post: Post): Post => ({
  ...post,
  author: normalizeActor(post.author),
});

export const normalizeStory = (story: Story): Story => ({
  ...story,
  author: normalizeActor(story.author),
});

export const normalizeActorStories = (stories: ActorStories): ActorStories => ({
  ...stories,
  actor: normalizeActor(stories.actor),
  stories: (stories.stories || []).map(normalizeStory),
});

export const normalizeActorNote = (note: ActorNote): ActorNote => ({
  ...note,
  actor: normalizeActor(note.actor),
});

export const normalizeNotification = (
  notification: Notification,
): Notification => {
  // Fill the navigation target so consumers get a stable, safe same-origin
  // path even from a pre-3.2.0 server that omitted target_* (or sent an unsafe
  // target_url). resolveNotificationTarget re-validates a declared target and
  // otherwise synthesizes it from type + object_ap_id.
  const target = resolveNotificationTarget(notification);
  return {
    ...notification,
    actor: normalizeActor(notification.actor),
    target_kind: target.target_kind,
    target_id: target.target_id,
    target_url: target.target_url,
  };
};
