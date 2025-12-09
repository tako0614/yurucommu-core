import type React from "react";

export type AuthUser = {
  id: string;
  handle: string;
  displayName: string;
  avatar?: string | null;
};

export type AuthState = {
  isLoggedIn: boolean;
  user: AuthUser | null;
  token: string | null;
};

export type CoreAPI = {
  fetch: (path: string, options?: RequestInit) => Promise<Response>;
  posts: {
    list: (params?: { limit?: number }) => Promise<Post[]>;
    get: (id: string) => Promise<Post>;
    create: (data: { content: string }) => Promise<Post>;
    delete: (id: string) => Promise<void>;
  };
  users: {
    get: (id: string) => Promise<User>;
    follow: (id: string) => Promise<void>;
    unfollow: (id: string) => Promise<void>;
  };
  timeline: {
    home: (params?: { limit?: number; cursor?: string }) => Promise<TimelineResponse>;
  };
  notifications: {
    list: (params?: { limit?: number }) => Promise<Notification[]>;
    markRead: (ids: string[]) => Promise<void>;
  };
  storage: {
    upload: (file: File, options?: UploadOptions) => Promise<StorageObject>;
    get: (key: string) => Promise<Blob | null>;
    delete: (key: string) => Promise<void>;
  };
};

export type AppAPI = {
  fetch: (path: string, options?: RequestInit) => Promise<Response>;
};

export type TakosRuntime = {
  navigate: (path: string, options?: { replace?: boolean }) => void;
  back: () => void;
  currentPath: string;
  params: Record<string, string>;
  query: Record<string, string>;
  auth: AuthState;
  core: CoreAPI;
  app: AppAPI;
  ui: {
    toast: (message: string, type?: "success" | "error" | "info") => void;
    confirm: (message: string) => Promise<boolean>;
    modal: {
      open: (component: React.ComponentType<any>, props?: Record<string, unknown>) => void;
      close: () => void;
    };
  };
  appInfo: {
    id: string;
    version: string;
    permissions: string[];
  };
};

export type ScreenConfig = {
  id?: string;
  path: string;
  component: React.ComponentType<any>;
  title?: string;
  auth?: "required" | "optional";
};

export type HandlerConfig<TInput = unknown, TOutput = unknown> = {
  id?: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  auth?: "required" | "optional" | "none";
  handler: (ctx: HandlerContext, input: TInput) => Promise<TOutput>;
};

export type AppDefinition = {
  id: string;
  name: string;
  version: string;
  description?: string;
  screens: ScreenConfig[];
  handlers?: HandlerConfig[];
  permissions?: string[];
};

export type HandlerContext = {
  auth: {
    userId: string;
    handle: string;
  };
  params: Record<string, string>;
  query: Record<string, string>;
  core: {
    posts: unknown;
    users: unknown;
    activitypub: unknown;
    storage: unknown;
    ai: unknown;
  };
  storage: {
    get: <T>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
    list: (prefix: string) => Promise<string[]>;
  };
  json: <T>(data: T, options?: { status?: number }) => Response;
  error: (message: string, status?: number) => Response;
};

export type Post = {
  id: string;
  content: string;
  createdAt?: string;
};

export type TimelineResponse = {
  posts: Post[];
  cursor?: string;
};

export type User = {
  id: string;
  handle: string;
  displayName: string;
  avatar?: string | null;
};

export type Notification = {
  id: string;
  type: string;
  createdAt?: string;
  data?: Record<string, unknown>;
};

export type UploadOptions = {
  contentType?: string;
  metadata?: Record<string, string>;
};

export type StorageObject = {
  key: string;
  url?: string;
  size?: number;
  contentType?: string;
};
