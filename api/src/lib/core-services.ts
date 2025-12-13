import type { CoreServices } from "@takos/platform/app/services";
import {
  createActorService,
  createMediaService,
  createNotificationService,
  createObjectService,
  createPostService,
  createStorageService,
  createUserService,
  createAuthService,
} from "../services";
import type { PublicAccountBindings as Bindings } from "@takos/platform/server";

/**
 * Build Core Kernel services bound to the current request environment.
 * Services lazily open database stores per operation, so constructing this
 * object is cheap and safe to reuse within a single request scope.
 *
 * NOTE: communities と dm は Core から削除済み (11-default-app.md)
 * - これらの機能は Default App (app/default) で KV ベースで実装
 * - REST API ルートは Default App にプロキシされる
 */
export const buildCoreServices = (env: Bindings): CoreServices => {
  const actors = createActorService(env as any);
  const notifications = createNotificationService(env as any);
  const storage = createStorageService(env as any);
  const objects = createObjectService(env as any);

  return {
    posts: createPostService(env as any),
    users: createUserService(env as any, actors, notifications),
    // communities と dm は App 層に移行済み - Default App を使用
    media: createMediaService(env as any, storage),
    objects,
    actors,
    storage,
    notifications,
    auth: createAuthService(env as any),
  };
};
