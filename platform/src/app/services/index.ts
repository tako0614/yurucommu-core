/**
 * Core Kernel Services API
 *
 * PLAN.md 3.11 に基づくサービスAPIのエクスポート
 * App Script から統一インターフェースでコア機能を利用可能にする
 */

// 型の重複を避けるため、必要な型のみを個別エクスポート
export type {
  PostService,
  CreatePostInput,
  UpdatePostInput,
  Post,
  PostPage,
  TimelineParams,
  SearchPostsParams,
  PostHistoryEntry,
  PollVoteInput,
  RepostInput,
  RepostListParams,
  RepostListResult,
  Reaction,
  BookmarkPage,
} from "./post-service";

// ObjectService (PLAN.md 10.2 / 10.5)
export type {
  ObjectService,
  ObjectServiceFactory,
  APObject,
  APObjectType,
  APVisibility,
  APAttachment,
  APTag,
  APPoll,
  APStory,
  APStoryItem,
  StoredObject,
  CreateObjectInput,
  UpdateObjectInput,
  ObjectQueryParams,
  ObjectTimelineParams,
  ObjectPage,
} from "./object-service";
export {
  visibilityToRecipients,
  recipientsToVisibility,
  createTakosContext,
  generateLocalId,
  generateObjectId,
  createObjectService,
} from "./object-service";
export type {
  UserService,
  UpdateProfileInput,
  FollowRequest,
  FollowRequestList,
  NotificationEntry,
} from "./user-service";
export type { ActorService, ActorServiceFactory, ActorProfile } from "./actor-service";
export type { StorageService, StorageServiceFactory, StorageListParams } from "./storage-service";
export type {
  NotificationService,
  NotificationServiceFactory,
  SendNotificationInput,
} from "./notification-service";
export type {
  CommunityService,
  Channel,
  CommunityMember,
  CreateChannelInput,
  UpdateChannelInput,
  ChannelMessage,
  ChannelMessageParams,
  SendChannelMessageInput,
} from "./community-service";
export type { DMService, DmThread, DmMessage, DmThreadPage, DmMessagePage, OpenThreadInput, SendMessageInput, ListThreadsParams, ListMessagesParams } from "./dm-service";
export type { StoryService, Story, StoryPage, StoryItem, CreateStoryInput, ListStoriesParams } from "./story-service";
export type { MediaService, MediaObject, ListMediaParams, MediaListResult } from "./media-service";
export type {
  AuthService,
  AuthServiceFactory,
  AuthLoginResult,
  ActorChangeResult,
} from "./auth-service";
export type {
  AppAuthContext,
  AppAuthRateLimits,
  AppAuthUser,
  AppPlanInfo,
  AppPlanLimits,
  AppPlanName,
} from "../runtime/types";

import type { PostService } from "./post-service";
import type { UserService } from "./user-service";
import type { CommunityService } from "./community-service";
import type { DMService } from "./dm-service";
import type { StoryService } from "./story-service";
import type { MediaService } from "./media-service";
import type { ObjectService } from "./object-service";
import type { ActorService } from "./actor-service";
import type { StorageService } from "./storage-service";
import type { NotificationService } from "./notification-service";
import type { AuthService } from "./auth-service";

export {
  createPostService,
  createDMService,
  createStoryService,
  createMediaService,
  createCommunityService,
  createUserService,
  createObjectService as createCoreObjectService,
  createActorService,
  createStorageService,
  createNotificationService,
  createAuthService,
} from "./factories";

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
  media?: MediaService;
  actors?: ActorService;
  storage?: StorageService;
  notifications?: NotificationService;
  /** Objects コレクション統合サービス (PLAN.md 10.2) */
  objects?: ObjectService;
  /** Auth / session / owner actor operations */
  auth?: AuthService;
}
