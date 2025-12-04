/**
 * MediaService Implementation
 *
 * ストレージ一覧・削除のApp Layer向けラッパー
 */

import type {
  MediaService,
  MediaListResult,
  MediaObject,
  AppAuthContext,
} from "@takos/platform/app/services";
import { makeData } from "../data";
import { releaseStore } from "@takos/platform/server";

export function createMediaService(env: any): MediaService {
  return {
    async listStorage(ctx: AppAuthContext, params?: { limit?: number; offset?: number }): Promise<MediaListResult> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }
      const store = makeData(env, null as any);
      try {
        const limit = Math.min(params?.limit || 50, 200);
        const offset = params?.offset || 0;
        const files = (await store.listMediaByUser?.(ctx.userId).catch(() => [])) || [];
        const paged = (files as any[]).slice(offset, offset + limit);
        const next = files.length > offset + paged.length ? offset + paged.length : null;
        return { files: paged as MediaObject[], next_offset: next };
      } finally {
        await releaseStore(store);
      }
    },

    async deleteStorageObject(
      ctx: AppAuthContext,
      key: string,
    ): Promise<{ deleted: boolean }> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }
      const store = makeData(env, null as any);
      try {
        // delete from R2 if bound
        if (env.MEDIA) {
          await env.MEDIA.delete(key).catch(() => {});
        }
        if (store.deleteMedia) {
          await store.deleteMedia(key);
        }
        return { deleted: true };
      } finally {
        await releaseStore(store);
      }
    },
  };
}
