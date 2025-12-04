/**
 * Core Kernel Services
 *
 * PLAN.md 3.11 に基づくサービスAPI実装
 *
 * Note: These are stub implementations. Full implementations are pending.
 */

import type {
  PostService,
  DMService,
  StoryService,
  CommunityService,
  UserService,
  MediaService,
} from "@takos/platform/app/services";

// Stub implementations - throw NotImplemented errors
export function createPostService(_env: unknown): PostService {
  throw new Error("PostService not implemented");
}

export function createDMService(_env: unknown): DMService {
  throw new Error("DMService not implemented");
}

export function createStoryService(_env: unknown): StoryService {
  throw new Error("StoryService not implemented");
}

export function createMediaService(_env: unknown): MediaService {
  throw new Error("MediaService not implemented");
}

export function createCommunityService(_env: unknown): CommunityService {
  throw new Error("CommunityService not implemented");
}

export function createUserService(_env: unknown): UserService {
  throw new Error("UserService not implemented");
}

export type {
  PostService,
  DMService,
  StoryService,
  CommunityService,
  UserService,
  MediaService,
} from "@takos/platform/app/services";
