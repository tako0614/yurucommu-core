/**
 * Storage Service API
 *
 * App Layer からストレージバケットへの共通アクセスを提供
 */

import type { AppAuthContext } from "../runtime/types";
import type { ListObjectsResult, StorageBucket } from "../storage/bucket-api";

export interface StorageListParams {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

export interface StorageService {
  /**
   * ストレージオブジェクト一覧を取得
   */
  list(ctx: AppAuthContext, params?: StorageListParams): Promise<ListObjectsResult>;

  /**
   * オブジェクトを削除
   */
  deleteObject(ctx: AppAuthContext, key: string): Promise<{ deleted: boolean }>;

  /**
   * 公開URLを取得
   */
  getPublicUrl(key: string): string;

  /**
   * バケットインスタンスを取得（必要に応じて実装）
   */
  bucket?(name: string): StorageBucket;
}

export type StorageServiceFactory = (env: unknown) => StorageService;
