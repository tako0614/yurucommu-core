import { Actor, Post, Story, Notification, ActorStories } from '../../types';

type ActorLike = { ap_id: string; username?: string; preferred_username?: string };

function formatUsernameFromApId(apId: string, preferred?: string): string | null {
  try {
    const url = new URL(apId);
    const match = apId.match(/\/(users|groups)\/([^/]+)$/);
    if (match) return `${match[2]}@${url.host}`;
    if (preferred) return `${preferred}@${url.host}`;
  } catch {
    // Ignore malformed URLs and fallback to existing fields.
  }
  return null;
}

export function normalizeActor<T extends ActorLike>(actor: T): T {
  if (!actor || !actor.ap_id) return actor;
  const rawUsername = actor.username?.trim();
  const formatted =
    rawUsername ||
    formatUsernameFromApId(actor.ap_id, actor.preferred_username) ||
    actor.preferred_username ||
    actor.username ||
    actor.ap_id;
  const preferred =
    actor.preferred_username?.trim() ||
    (formatted.includes('@') ? formatted.split('@')[0] : formatted);

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

export const normalizeNotification = (notification: Notification): Notification => ({
  ...notification,
  actor: normalizeActor(notification.actor),
});
