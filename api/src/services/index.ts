export {
  createPostService,
  createMediaService,
  createUserService,
  createObjectService,
  createActorService,
  createStorageService,
  createNotificationService,
  createAuthService,
} from "@takos/platform/app/services";

export type {
  PostService,
  // DMService と CommunityService は App 層に移行済み - 型のみエクスポート
  DMService,
  CommunityService,
  UserService,
  MediaService,
  ObjectService,
  ActorService,
  StorageService,
  NotificationService,
  AuthService,
} from "@takos/platform/app/services";
