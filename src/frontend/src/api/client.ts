/**
 * API Client for yurucommu backend
 */

// Default to relative URL for standalone deployment
// Can be overridden for embedded usage
let API_BASE = '';

export function setApiBase(base: string) {
  API_BASE = base;
}

export function getApiBase(): string {
  return API_BASE;
}

export interface ApiError {
  error: string;
  error_description?: string;
}

export interface User {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  summary?: string;
  avatar_url?: string | null;
  header_url?: string | null;
  auth_provider?: 'local' | 'oauth2';
}

export interface Post {
  id: string;
  content: string;
  content_warning: string | null;
  visibility: 'public' | 'unlisted' | 'followers' | 'direct';
  published_at: string;
  in_reply_to_id: string | null;
  attachments?: Array<{
    type: 'image' | 'link';
    url: string;
    description?: string;
  }>;
}

export interface Notification {
  id: string;
  type: 'follow' | 'like' | 'announce' | 'mention' | 'reply';
  actor_url: string;
  object_url: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AuthStatus {
  authenticated: boolean;
  user: User | null;
  methods: {
    password: boolean;
    oauth: boolean;
  };
}

export interface Config {
  siteName: string;
  siteDescription: string;
  maxPostLength: number;
  features: {
    enableBoosts: boolean;
    enableLikes: boolean;
    enableReplies: boolean;
    enableMediaUpload: boolean;
  };
}

class ApiClient {
  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  // ============================================
  // Authentication
  // ============================================

  async getAuthStatus(): Promise<AuthStatus> {
    return this.request<AuthStatus>('/auth/status');
  }

  async login(email: string, password: string): Promise<{ user: User }> {
    return this.request<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async register(data: {
    username: string;
    email: string;
    password: string;
    display_name?: string;
  }): Promise<{ user: User }> {
    return this.request<{ user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async logout(): Promise<void> {
    await this.request<{ success: boolean }>('/auth/logout', {
      method: 'POST',
    });
  }

  getOAuthUrl(): string {
    return '/auth/oauth/authorize';
  }

  // ============================================
  // User
  // ============================================

  async getMe(): Promise<User> {
    return this.request<User>('/api/me');
  }

  async updateMe(data: Partial<User>): Promise<User> {
    return this.request<User>('/api/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async setup(data: {
    username: string;
    display_name: string;
    summary?: string;
  }): Promise<User> {
    return this.request<User>('/api/setup', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ============================================
  // Posts
  // ============================================

  async createPost(data: {
    content: string;
    content_warning?: string;
    visibility?: string;
  }): Promise<Post> {
    return this.request<Post>('/api/posts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getPosts(): Promise<Post[]> {
    return this.request<Post[]>('/api/posts');
  }

  async deletePost(id: string): Promise<void> {
    await this.request<{ success: boolean }>(`/api/posts/${id}`, {
      method: 'DELETE',
    });
  }

  async getTimeline(): Promise<Post[]> {
    return this.request<Post[]>('/api/timeline/home');
  }

  // ============================================
  // Notifications
  // ============================================

  async getNotifications(): Promise<Notification[]> {
    return this.request<Notification[]>('/api/notifications');
  }

  async markNotificationsRead(): Promise<void> {
    await this.request<{ success: boolean }>('/api/notifications/read', {
      method: 'POST',
    });
  }

  // ============================================
  // Follow
  // ============================================

  async follow(account: string): Promise<void> {
    await this.request<{ success: boolean }>('/api/follow', {
      method: 'POST',
      body: JSON.stringify({ account }),
    });
  }

  async unfollow(account: string): Promise<void> {
    await this.request<{ success: boolean }>('/api/unfollow', {
      method: 'POST',
      body: JSON.stringify({ account }),
    });
  }

  async getFollowing(): Promise<Array<{ actor_url: string; status: string }>> {
    return this.request<Array<{ actor_url: string; status: string }>>('/api/following');
  }

  async getFollowers(): Promise<Array<{ actor_url: string; status: string }>> {
    return this.request<Array<{ actor_url: string; status: string }>>('/api/followers');
  }

  // ============================================
  // Config
  // ============================================

  async getConfig(): Promise<Config> {
    return this.request<Config>('/api/config');
  }
}

export const api = new ApiClient();
