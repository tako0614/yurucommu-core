/**
 * Core Kernel Services API
 *
 * PLAN.md 3.11 に基づくサービスAPIのエクスポート
 * App Script から統一インターフェースでコア機能を利用可能にする
 */

// 型の重複を避けるため、必要な型のみを個別エクスポート
export type { PostService, CreatePostInput, UpdatePostInput, Post, PostPage, TimelineParams } from "./post-service";
export type { UserService } from "./user-service";
export type { CommunityService } from "./community-service";
export type { DMService, DmThread, DmMessage, DmThreadPage, DmMessagePage, OpenThreadInput, SendMessageInput, ListThreadsParams, ListMessagesParams } from "./dm-service";
export type { StoryService, Story, StoryPage, StoryItem, CreateStoryInput, ListStoriesParams } from "./story-service";

import type { PostService } from "./post-service";
import type { UserService } from "./user-service";
import type { CommunityService } from "./community-service";
import type { DMService } from "./dm-service";
import type { StoryService } from "./story-service";

/**
 * Core Kernel サービスのレジストリ
 *
 * TakosContext.services として公開される
 */
export interface CoreServices {
  posts: PostService;
  users: UserService;
  communities: CommunityService;
  dm: DMService;
  stories: StoryService;
}
