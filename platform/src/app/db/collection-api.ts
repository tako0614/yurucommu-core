/**
 * App Collection API
 *
 * PLAN.md 5.4.5 ctx.db() の詳細実装
 * App独自コレクション（app:* 名前空間）への操作インターフェース
 */

export type CollectionWhereClause = Record<string, unknown>;
export type CollectionOrderBy = { column: string; direction: "asc" | "desc" };
export type CollectionUpdateData = Record<string, unknown>;

/**
 * App Collection操作インターフェース
 *
 * ctx.db("app:notes") のような形で取得される
 */
export interface CollectionQuery<T = Record<string, unknown>> {
  /**
   * すべてのレコードを取得
   * @returns レコード配列
   */
  all(): Promise<T[]>;

  /**
   * 最初の1件を取得
   * @returns レコード（存在しない場合はnull）
   */
  first(): Promise<T | null>;

  /**
   * 条件に一致するレコードをフィルター
   * @param where 検索条件
   * @returns クエリビルダー
   */
  where(where: CollectionWhereClause): CollectionQuery<T>;

  /**
   * ソート順を指定
   * @param column カラム名
   * @param direction 昇順/降順
   * @returns クエリビルダー
   */
  orderBy(column: string, direction?: "asc" | "desc"): CollectionQuery<T>;

  /**
   * 取得件数を制限
   * @param limit 最大件数
   * @returns クエリビルダー
   */
  limit(limit: number): CollectionQuery<T>;

  /**
   * オフセットを指定
   * @param offset スキップする件数
   * @returns クエリビルダー
   */
  offset(offset: number): CollectionQuery<T>;

  /**
   * 件数をカウント
   * @returns レコード数
   */
  count(): Promise<number>;
}

/**
 * App Collection操作の完全なインターフェース
 */
export interface Collection<T = Record<string, unknown>> {
  /**
   * クエリビルダーを取得（条件なし）
   * @returns クエリビルダー
   */
  find(where?: CollectionWhereClause): CollectionQuery<T>;

  /**
   * IDでレコードを取得
   * @param id レコードID
   * @returns レコード（存在しない場合はnull）
   */
  findById(id: string | number): Promise<T | null>;

  /**
   * 新規レコードを作成
   * @param data レコードデータ
   * @returns 作成されたレコード
   */
  create(data: Partial<T>): Promise<T>;

  /**
   * レコードを更新
   * @param where 更新対象の条件
   * @param data 更新データ
   * @returns 更新件数
   */
  update(where: CollectionWhereClause, data: CollectionUpdateData): Promise<number>;

  /**
   * IDでレコードを更新
   * @param id レコードID
   * @param data 更新データ
   * @returns 更新されたレコード（存在しない場合はnull）
   */
  updateById(id: string | number, data: CollectionUpdateData): Promise<T | null>;

  /**
   * レコードを削除
   * @param where 削除対象の条件
   * @returns 削除件数
   */
  delete(where: CollectionWhereClause): Promise<number>;

  /**
   * IDでレコードを削除
   * @param id レコードID
   * @returns 削除されたかどうか
   */
  deleteById(id: string | number): Promise<boolean>;

  /**
   * トランザクションを開始
   * @param callback トランザクション内での操作
   * @returns トランザクション結果
   */
  transaction<R>(callback: (tx: Collection<T>) => Promise<R>): Promise<R>;
}

/**
 * Collection を作成するファクトリー関数の型
 */
export type CollectionFactory = <T = Record<string, unknown>>(
  name: string,
  mode: "prod" | "dev",
  workspaceId?: string,
) => Collection<T>;
