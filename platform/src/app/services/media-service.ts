/**
 * Media/Storage Service API
 *
 * App Layer からストレージ操作を行うための薄いインターフェース
 */

import type { AppAuthContext } from "../runtime/types";

export interface MediaObject {
  id: string;
  url: string;
  created_at?: string;
  size?: number;
  content_type?: string;
  [key: string]: unknown;
}

export interface ListMediaParams {
  limit?: number;
  offset?: number;
}

export interface MediaListResult {
  files: MediaObject[];
  next_offset: number | null;
}

export interface MediaService {
  /**
   * ユーザーのストレージ一覧を取得
   */
  listStorage(ctx: AppAuthContext, params?: ListMediaParams): Promise<MediaListResult>;

  /**
   * ストレージオブジェクトを削除
   */
  deleteStorageObject(ctx: AppAuthContext, key: string): Promise<{ deleted: boolean }>;
}

export type MediaServiceFactory = (env: unknown) => MediaService;
