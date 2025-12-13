/**
 * Core Kernel Services API
 *
 * PLAN.md 3.11 に基づくサービスAPIのエクスポート
 * App Script から統一インターフェースでコア機能を利用可能にする
 *
 * NOTE: Community と DM 機能は App 層（Default App）に完全移行済み
 * 実装: app/default/src/server.ts
 */

// PostService types
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

// UserService types
export type {
  UserService,
  UpdateProfileInput,
  FollowRequest,
  FollowRequestList,
  NotificationEntry,
} from "./user-service";

// ActorService types
export type { ActorService, ActorServiceFactory, ActorProfile } from "./actor-service";

// StorageService types
export type { StorageService, StorageServiceFactory, StorageListParams } from "./storage-service";

// NotificationService types
export type {
  NotificationService,
  NotificationServiceFactory,
  SendNotificationInput,
} from "./notification-service";

// MediaService types
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

// AuthService types
export type {
  AuthService,
  AuthServiceFactory,
  AuthLoginResult,
  ActorChangeResult,
} from "./auth-service";

// NOTE: BlockMuteService は App 層（Default App）に完全移行済み
// 実装: app/default/src/server.ts の /blocks, /mutes エンドポイント

// Runtime types
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

/**
 * Core Kernel サービスのレジストリ
 *
 * TakosContext.services として公開される
 *
 * NOTE: Community と DM は App 層に完全移行済み (11-default-app.md)
 * Default App が KV ベースで実装しており、Core API ルートは Default App にプロキシ
 */
export interface CoreServices {
  posts: PostService;
  users: UserService;
  media?: MediaService;
  actors?: ActorService;
  storage?: StorageService;
  notifications?: NotificationService;
  /** Objects コレクション統合サービス (PLAN.md 10.2) */
  objects?: ObjectService;
  /** Auth / session / owner actor operations */
  auth?: AuthService;
}
