/**
 * Core Kernel Services
 *
 * PLAN.md 3.11 に基づくサービスAPI実装
 */

export { createPostService } from "./post-service-impl";
export { createDMService } from "./dm-service-impl";
export { createStoryService } from "./story-service-impl";
export { createCommunityService } from "./community-service-impl";
export { createUserService } from "./user-service-impl";

export type {
  PostService,
  DMService,
  StoryService,
  CommunityService,
  UserService,
} from "@takos/platform/app/services";
