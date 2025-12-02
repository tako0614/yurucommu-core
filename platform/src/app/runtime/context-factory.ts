/**
 * TakosContext Factory
 *
 * PLAN.md 5.4.5 に基づく TakosContext の実装ファクトリー
 */

import type {
  TakosContext,
  AppAuthContext,
  AppRuntimeMode,
  AppLogLevel,
  AppLogSink,
  AppJsonResponse,
  AppErrorResponse,
  AppRedirectResponse,
  AppResponseInit,
  ServiceRegistry,
} from "./types";
import type { AiProviderRegistry } from "../../ai/provider-registry";
import type { Collection, CollectionFactory } from "../db/collection-api";
import type { StorageBucket, StorageBucketFactory } from "../storage/bucket-api";

export interface CreateTakosContextOptions {
  mode: AppRuntimeMode;
  workspaceId?: string;
  handler?: string;
  auth?: AppAuthContext;
  services: ServiceRegistry;
  collectionFactory: CollectionFactory;
  storageBucketFactory: StorageBucketFactory;
  aiProviders?: AiProviderRegistry | null;
  logSink?: AppLogSink;
}

/**
 * TakosContext を作成
 *
 * @param options コンテキスト作成オプション
 * @returns TakosContext インスタンス
 */
export function createTakosContext<TServices extends ServiceRegistry = ServiceRegistry>(
  options: CreateTakosContextOptions,
): TakosContext<TServices, Collection, StorageBucket> {
  const {
    mode,
    workspaceId,
    handler,
    auth,
    services,
    collectionFactory,
    storageBucketFactory,
    aiProviders,
    logSink,
  } = options;

  // ランダムなrun IDを生成
  const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // ログ関数
  const log = (level: AppLogLevel, message: string, data?: Record<string, unknown>) => {
    const entry = {
      timestamp: new Date().toISOString(),
      mode,
      workspaceId,
      runId,
      handler,
      level,
      message,
      data,
    };

    // ログシンクに送信（非同期だがawaitしない）
    if (logSink) {
      Promise.resolve(logSink(entry)).catch((err) => {
        console.error("Log sink error:", err);
      });
    }

    // コンソールにも出力
    const logMethod = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    logMethod(`[${level.toUpperCase()}] ${message}`, data || "");
  };

  // レスポンス生成ヘルパー
  const json = <T = unknown>(body: T, init?: AppResponseInit): AppJsonResponse<T> => {
    return {
      type: "json",
      status: init?.status ?? 200,
      headers: init?.headers,
      body,
    };
  };

  const error = (message: string, status?: number): AppErrorResponse => {
    return {
      type: "error",
      status: status ?? 500,
      message,
    };
  };

  const redirect = (location: string, status?: number): AppRedirectResponse => {
    return {
      type: "redirect",
      status: status ?? 302,
      location,
      headers: { Location: location },
    };
  };

  // db() 関数: App独自コレクションを取得
  const db = <T = Record<string, unknown>>(name: string): Collection<T> => {
    // app:* プレフィックスをチェック
    if (!name.startsWith("app:")) {
      throw new Error(
        `Collection name must start with "app:" prefix. Got: "${name}". ` +
          `Core tables cannot be accessed directly via ctx.db(). Use ctx.services instead.`,
      );
    }

    return collectionFactory<T>(name, mode, workspaceId);
  };

  // storage() 関数: App独自ストレージバケットを取得
  const storage = (name: string): StorageBucket => {
    // app:* プレフィックスをチェック
    if (!name.startsWith("app:")) {
      throw new Error(
        `Storage bucket name must start with "app:" prefix. Got: "${name}". ` +
          `Core storage cannot be accessed directly via ctx.storage().`,
      );
    }

    return storageBucketFactory(name, mode, workspaceId);
  };

  // AI runtime
  const ai = {
    providers: aiProviders ?? null,
  };

  return {
    mode,
    workspaceId,
    runId,
    handler,
    auth,
    services: services as TServices,
    db,
    storage,
    ai,
    log,
    json,
    error,
    redirect,
  };
}
