/**
 * Quota Enforcement Utilities
 *
 * プラン制限の強制チェックを行うユーティリティ
 * 各エンドポイントで使用し、制限超過時は適切なエラーを返す
 */

import type { Context } from "hono";
import type { AuthContext, PlanLimits } from "./auth-context-model";
import { HttpError } from "@takos/platform/server";

export type QuotaCheckResult = {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
  message?: string;
};

/**
 * ファイルサイズ制限のチェック
 */
export function checkFileSizeLimit(limits: PlanLimits, fileSize: number): QuotaCheckResult {
  const limit = limits.fileSize;
  const allowed = fileSize <= limit;
  return {
    allowed,
    current: fileSize,
    limit,
    remaining: Math.max(0, limit - fileSize),
    message: allowed ? undefined : `File size ${formatBytes(fileSize)} exceeds limit of ${formatBytes(limit)}`,
  };
}

/**
 * DM メディアサイズ制限のチェック
 */
export function checkDmMediaSizeLimit(limits: PlanLimits, fileSize: number): QuotaCheckResult {
  const limit = limits.dmMediaSize;
  const allowed = fileSize <= limit;
  return {
    allowed,
    current: fileSize,
    limit,
    remaining: Math.max(0, limit - fileSize),
    message: allowed ? undefined : `DM media size ${formatBytes(fileSize)} exceeds limit of ${formatBytes(limit)}`,
  };
}

/**
 * AI 機能が有効かチェック
 */
export function checkAiFeature(ctx: AuthContext): boolean {
  const features = ctx.plan.features;
  return features.includes("*") || features.includes("ai");
}

/**
 * AI リクエスト制限のチェック（カウンタ付き）
 *
 * 実際の使用量は KV または DB で追跡する必要がある
 */
export function checkAiRequestLimit(limits: PlanLimits, currentUsage: number): QuotaCheckResult {
  const limit = limits.aiRequests;
  const allowed = currentUsage < limit;
  return {
    allowed,
    current: currentUsage,
    limit,
    remaining: Math.max(0, limit - currentUsage),
    message: allowed ? undefined : `AI request limit reached (${currentUsage}/${limit})`,
  };
}

/**
 * ストレージ制限のチェック
 */
export function checkStorageLimit(limits: PlanLimits, currentUsage: number, additionalSize: number): QuotaCheckResult {
  const limit = limits.storage;
  const newUsage = currentUsage + additionalSize;
  const allowed = newUsage <= limit;
  return {
    allowed,
    current: currentUsage,
    limit,
    remaining: Math.max(0, limit - currentUsage),
    message: allowed
      ? undefined
      : `Storage limit would be exceeded: ${formatBytes(newUsage)} > ${formatBytes(limit)}`,
  };
}

/**
 * 制限チェックを行い、超過時は HttpError をスロー
 */
export function enforceLimit(result: QuotaCheckResult, errorCode: string = "QUOTA_EXCEEDED"): void {
  if (!result.allowed) {
    throw new HttpError(403, errorCode, result.message ?? "Quota exceeded");
  }
}

/**
 * ファイルサイズ制限を強制
 */
export function enforceFileSizeLimit(limits: PlanLimits, fileSize: number): void {
  enforceLimit(checkFileSizeLimit(limits, fileSize), "FILE_SIZE_EXCEEDED");
}

/**
 * DM メディアサイズ制限を強制
 */
export function enforceDmMediaSizeLimit(limits: PlanLimits, fileSize: number): void {
  enforceLimit(checkDmMediaSizeLimit(limits, fileSize), "DM_MEDIA_SIZE_EXCEEDED");
}

/**
 * AI 機能の有効性を強制
 */
export function enforceAiFeature(ctx: AuthContext): void {
  if (!checkAiFeature(ctx)) {
    throw new HttpError(403, "AI_NOT_AVAILABLE", "AI feature is not available on your plan");
  }
}

/**
 * AI リクエスト制限を強制
 */
export function enforceAiRequestLimit(limits: PlanLimits, currentUsage: number): void {
  enforceLimit(checkAiRequestLimit(limits, currentUsage), "AI_QUOTA_EXCEEDED");
}

/**
 * ストレージ制限を強制
 */
export function enforceStorageLimit(limits: PlanLimits, currentUsage: number, additionalSize: number): void {
  enforceLimit(checkStorageLimit(limits, currentUsage, additionalSize), "STORAGE_QUOTA_EXCEEDED");
}

// Utility functions

function formatBytes(bytes: number): string {
  if (bytes === Number.MAX_SAFE_INTEGER) return "unlimited";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * レスポンスヘッダーに制限情報を追加
 */
export function addQuotaHeaders(c: Context, result: QuotaCheckResult, prefix: string = "X-Quota"): void {
  c.header(`${prefix}-Limit`, String(result.limit));
  c.header(`${prefix}-Remaining`, String(result.remaining));
  c.header(`${prefix}-Used`, String(result.current));
}
