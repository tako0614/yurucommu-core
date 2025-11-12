/**
 * Common API client functions shared between frontend and mobile app
 * 
 * This module contains platform-independent API functions.
 * Platform-specific implementations (token management, fetch wrappers, etc.)
 * should be provided by the consuming application.
 */

import type {
  User,
  Community,
  Post,
  FriendEdge,
  Channel,
  Notification,
  CommunityInvitation,
  ApiRequestInit,
} from './types';

/**
 * API client configuration
 */
export type ApiClientConfig = {
  /** Base API function that handles auth, errors, and response parsing */
  apiFetch: <T = unknown>(path: string, init?: ApiRequestInit) => Promise<T>;
  /** Backend URL resolver (e.g., for handling proxies in dev) */
  resolveUrl: (path: string) => string;
};

/**
 * Create an API client with the given configuration
 */
export function createApiClient(config: ApiClientConfig) {
  const { apiFetch } = config;

  return {
    // ---- User APIs ----
    async fetchMe() {
      return apiFetch<User>('/me');
    },

    async updateMe(fields: {
      display_name?: string;
      avatar_url?: string | null;
      handle?: string | null;
    }) {
      return apiFetch<User>('/me', {
        method: 'PATCH',
        body: fields,
      });
    },

    async getUser(id: string) {
      return apiFetch<User>(`/users/${encodeURIComponent(id)}`);
    },

    async searchUsers(q: string) {
      const query = q.trim();
      if (!query) {
        return [] as User[];
      }
      const normalized = query.startsWith('@') ? query.slice(1) : query;
      if (!normalized) {
        return [] as User[];
      }
      const result = await apiFetch<User[] | Record<string, unknown>>(
        `/users?q=${encodeURIComponent(normalized)}`,
      );
      return Array.isArray(result) ? result : [];
    },

    // ---- Community APIs ----
    async listMyCommunities() {
      return apiFetch<Community[]>('/me/communities');
    },

    async searchCommunities(q: string) {
      const query = q.trim();
      if (!query) {
        return [] as Community[];
      }
      return apiFetch<Community[]>(`/communities?q=${encodeURIComponent(query)}`);
    },

    async createCommunity(name: string) {
      return apiFetch<Community>('/communities', {
        method: 'POST',
        body: { name },
      });
    },

    async updateCommunity(
      id: string,
      fields: {
        name?: string;
        icon_url?: string;
        description?: string;
        invite_policy?: 'owner_mod' | 'members';
        visibility?: string;
      },
    ) {
      return apiFetch<Community>(`/communities/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: fields,
      });
    },

    async listCommunityPosts(communityId: string) {
      return apiFetch<Post[]>(`/communities/${encodeURIComponent(communityId)}/posts`);
    },

    async createCommunityPost(communityId: string, payload: {
      text: string;
      type?: string;
      media_urls?: string[];
      audience?: 'community' | 'all';
    }) {
      const { audience = 'all', ...rest } = payload;
      const body: Record<string, unknown> = {
        ...rest,
        audience,
      };
      if (audience === 'community') {
        body.visible_to_friends = false;
      }
      return apiFetch<Post>(`/communities/${encodeURIComponent(communityId)}/posts`, {
        method: 'POST',
        body,
      });
    },

    // ---- Channel APIs ----
    async listCommunityChannels(communityId: string) {
      return apiFetch<Channel[]>(`/communities/${encodeURIComponent(communityId)}/channels`);
    },

    async createChannel(communityId: string, name: string) {
      return apiFetch<Channel>(`/communities/${encodeURIComponent(communityId)}/channels`, {
        method: 'POST',
        body: { name },
      });
    },

    async updateChannel(communityId: string, channelId: string, name: string) {
      return apiFetch<Channel>(
        `/communities/${encodeURIComponent(communityId)}/channels/${encodeURIComponent(channelId)}`,
        {
          method: 'PATCH',
          body: { name },
        },
      );
    },

    async deleteChannel(communityId: string, channelId: string) {
      return apiFetch<null>(
        `/communities/${encodeURIComponent(communityId)}/channels/${encodeURIComponent(channelId)}`,
        {
          method: 'DELETE',
        },
      );
    },

    // ---- Friendship APIs ----
    async listMyFriends() {
      return apiFetch<FriendEdge[]>('/me/friends');
    },

    async listMyFriendRequests(direction?: 'incoming' | 'outgoing') {
      const query = direction ? `?direction=${encodeURIComponent(direction)}` : '';
      return apiFetch<FriendEdge[]>(`/me/friend-requests${query}`);
    },

    async sendFriendRequest(userId: string) {
      return apiFetch(`/users/${encodeURIComponent(userId)}/friends`, {
        method: 'POST',
      });
    },

    async acceptFriendRequest(userId: string) {
      return apiFetch(`/users/${encodeURIComponent(userId)}/friends/accept`, {
        method: 'POST',
      });
    },

    async rejectFriendRequest(userId: string) {
      return apiFetch(`/users/${encodeURIComponent(userId)}/friends/reject`, {
        method: 'POST',
      });
    },

    // ---- Invitation APIs ----
    async listMyInvitations() {
      return apiFetch<CommunityInvitation[]>('/me/invitations');
    },

    async acceptCommunityInvite(communityId: string) {
      return apiFetch(`/communities/${encodeURIComponent(communityId)}/invitations/accept`, {
        method: 'POST',
      });
    },

    async declineCommunityInvite(communityId: string) {
      return apiFetch(`/communities/${encodeURIComponent(communityId)}/invitations/decline`, {
        method: 'POST',
      });
    },

    // ---- Notification APIs ----
    async listNotifications() {
      return apiFetch<Notification[]>('/notifications');
    },

    async markNotificationRead(id: string) {
      return apiFetch(`/notifications/${encodeURIComponent(id)}/read`, {
        method: 'POST',
      });
    },

    // ---- Push Device APIs ----
    async registerPushDevice(payload: {
      token: string;
      platform?: string;
      device_name?: string;
      locale?: string;
    }) {
      return apiFetch('/me/push-devices', {
        method: 'POST',
        body: payload,
      });
    },

    async removePushDevice(token: string) {
      return apiFetch('/me/push-devices', {
        method: 'DELETE',
        body: { token },
      });
    },

    // ---- Auth APIs ----
    async logout() {
      return apiFetch('/auth/logout', { method: 'POST' });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

