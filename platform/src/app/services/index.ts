/**
 * Core Kernel Services API
 *
 * PLAN.md 3.11 に基づくサービスAPIのエクスポート
 * App Script から統一インターフェースでコア機能を利用可能にする
 */

export * from "./post-service";
export * from "./user-service";
export * from "./community-service";

import type { PostService } from "./post-service";
import type { UserService } from "./user-service";
import type { CommunityService } from "./community-service";

/**
 * Core Kernel サービスのレジストリ
 *
 * TakosContext.services として公開される
 */
export interface CoreServices {
  posts: PostService;
  users: UserService;
  communities: CommunityService;
}
