/**
 * Common Story API functions
 */

import type { Story, StoryItem } from '../stories/story-schema';
import type { ApiRequestInit } from './types';

/**
 * Story API client configuration
 */
export type StoryApiConfig = {
  /** Base API function that handles auth, errors, and response parsing */
  apiFetch: <T = unknown>(path: string, init?: ApiRequestInit) => Promise<T>;
};

/**
 * Create a Story API client
 */
export function createStoryApi(config: StoryApiConfig) {
  const { apiFetch } = config;

  return {
    async listStories(communityId: string): Promise<Story[]> {
      return apiFetch(`/communities/${encodeURIComponent(communityId)}/stories`);
    },

    async listGlobalStories(): Promise<Story[]> {
      return apiFetch('/stories');
    },

    async createStory(
      communityId: string | null,
      items: StoryItem[],
      options?: { audience?: 'community' | 'all' },
    ): Promise<Story> {
      const body: Record<string, unknown> = { items };
      const audience = options?.audience ?? 'all';
      body.audience = audience;
      if (audience === 'community') {
        body.visible_to_friends = false;
      }

      if (communityId) {
        return apiFetch(`/communities/${encodeURIComponent(communityId)}/stories`, {
          method: 'POST',
          body,
        });
      }

      return apiFetch('/stories', {
        method: 'POST',
        body,
      });
    },

    async getStory(storyId: string): Promise<Story> {
      return apiFetch(`/stories/${encodeURIComponent(storyId)}`);
    },

    async updateStory(
      storyId: string,
      patch: Partial<Pick<Story, 'items' | 'expires_at'>> & {
        extendHours?: number;
      },
    ): Promise<Story> {
      return apiFetch(`/stories/${encodeURIComponent(storyId)}`, {
        method: 'PATCH',
        body: patch,
      });
    },

    async deleteStory(storyId: string): Promise<{ id: string; deleted: true }> {
      return apiFetch(`/stories/${encodeURIComponent(storyId)}`, { method: 'DELETE' });
    },
  };
}

export type StoryApiClient = ReturnType<typeof createStoryApi>;

