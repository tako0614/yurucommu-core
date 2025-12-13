import type { CoreServices } from "@takos/platform/app/services";
import {
  createActorService,
  createCommunityService,
  createDMService,
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
 */
export const buildCoreServices = (env: Bindings): CoreServices => {
  const actors = createActorService(env as any);
  const notifications = createNotificationService(env as any);
  const storage = createStorageService(env as any);
  const objects = createObjectService(env as any);

  return {
    posts: createPostService(env as any),
    users: createUserService(env as any, actors, notifications),
    communities: createCommunityService(env as any),
    dm: createDMService(env as any),
    media: createMediaService(env as any, storage),
    objects,
    actors,
    storage,
    notifications,
    auth: createAuthService(env as any),
  };
};
