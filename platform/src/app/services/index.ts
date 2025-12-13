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
export type {
  DMService,
  DmThread,
  DmMessage,
  DmThreadPage,
  DmMessagePage,
  OpenThreadInput,
  SendMessageInput,
  ListThreadsParams,
  ListMessagesParams,
  MarkReadInput,
} from "./dm-service";
export type {
  MediaService,
  MediaObject,
  MediaMetadata,
  MediaStatus,
  ListMediaParams,
  MediaListResult,
  UploadMediaInput,
  ImageTransformOptions,
} from "./media-service";
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
import type { MediaService } from "./media-service";
import type { ObjectService } from "./object-service";
import type { ActorService } from "./actor-service";
import type { StorageService } from "./storage-service";
import type { NotificationService } from "./notification-service";
import type { AuthService } from "./auth-service";

export {
  createPostService,
  createMediaService,
  createUserService,
  createObjectService as createCoreObjectService,
  createActorService,
  createStorageService,
  createNotificationService,
  createAuthService,
} from "./factories";

// NOTE: createCommunityService と createDMService は App 層に移行済み
// - 型定義のみ維持（後方互換性）
// - 実装は app/default/src/server.ts を参照

/**
 * Core Kernel サービスのレジストリ
 *
 * TakosContext.services として公開される
 *
 * NOTE: communities と dm は App 層に移行済み (11-default-app.md)
 * - Default App が KV ベースで実装
 * - 型定義のみ維持（後方互換性）
 */
export interface CoreServices {
  posts: PostService;
  users: UserService;
  /** @deprecated App層に移行済み - Default Appを使用してください */
  communities?: CommunityService;
  /** @deprecated App層に移行済み - Default Appを使用してください */
  dm?: DMService;
  media?: MediaService;
  actors?: ActorService;
  storage?: StorageService;
  notifications?: NotificationService;
  /** Objects コレクション統合サービス (PLAN.md 10.2) */
  objects?: ObjectService;
  /** Auth / session / owner actor operations */
  auth?: AuthService;
}
