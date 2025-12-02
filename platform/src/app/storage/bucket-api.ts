/**
 * App Storage Bucket API
 *
 * PLAN.md 5.4.5 ctx.storage() の詳細実装
 * App独自ストレージバケット（app:* 名前空間）への操作インターフェース
 */

export type StorageMetadata = Record<string, string>;

export interface StorageObject {
  key: string;
  size: number;
  etag?: string;
  lastModified?: Date;
  contentType?: string;
  metadata?: StorageMetadata;
}

export interface PutObjectOptions {
  contentType?: string;
  metadata?: StorageMetadata;
  cacheControl?: string;
}

export interface ListObjectsOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

export interface ListObjectsResult {
  objects: StorageObject[];
  cursor?: string;
  truncated: boolean;
}

/**
 * App Storage Bucket操作インターフェース
 *
 * ctx.storage("app:attachments") のような形で取得される
 */
export interface StorageBucket {
  /**
   * オブジェクトをアップロード
   * @param key オブジェクトキー（パス）
   * @param body アップロードするデータ
   * @param options オプション（ContentType, メタデータなど）
   * @returns アップロードされたオブジェクト情報
   */
  put(key: string, body: string | ArrayBuffer | Blob, options?: PutObjectOptions): Promise<StorageObject>;

  /**
   * オブジェクトを取得
   * @param key オブジェクトキー
   * @returns オブジェクトデータ（存在しない場合はnull）
   */
  get(key: string): Promise<ArrayBuffer | null>;

  /**
   * オブジェクトを取得（テキストとして）
   * @param key オブジェクトキー
   * @returns テキストデータ（存在しない場合はnull）
   */
  getText(key: string): Promise<string | null>;

  /**
   * オブジェクトのメタデータを取得
   * @param key オブジェクトキー
   * @returns オブジェクト情報（存在しない場合はnull）
   */
  head(key: string): Promise<StorageObject | null>;

  /**
   * オブジェクトを削除
   * @param key オブジェクトキー
   * @returns 削除されたかどうか
   */
  delete(key: string): Promise<boolean>;

  /**
   * 複数のオブジェクトを削除
   * @param keys オブジェクトキーの配列
   * @returns 削除件数
   */
  deleteMany(keys: string[]): Promise<number>;

  /**
   * オブジェクト一覧を取得
   * @param options リストオプション（プレフィックス、ページネーションなど）
   * @returns オブジェクト一覧
   */
  list(options?: ListObjectsOptions): Promise<ListObjectsResult>;

  /**
   * 署名付きURLを生成（一時的なアクセス用）
   * @param key オブジェクトキー
   * @param expiresIn 有効期限（秒）
   * @returns 署名付きURL
   */
  getSignedUrl(key: string, expiresIn: number): Promise<string>;

  /**
   * 公開URLを取得
   * @param key オブジェクトキー
   * @returns 公開URL
   */
  getPublicUrl(key: string): string;
}

/**
 * StorageBucket を作成するファクトリー関数の型
 */
export type StorageBucketFactory = (
  name: string,
  mode: "prod" | "dev",
  workspaceId?: string,
) => StorageBucket;
