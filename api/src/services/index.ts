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

// NOTE: DMService と CommunityService は App 層に完全移行済み
// 実装: app/default/src/server.ts

export type {
  PostService,
  UserService,
  MediaService,
  ObjectService,
  ActorService,
  StorageService,
  NotificationService,
  AuthService,
} from "@takos/platform/app/services";
