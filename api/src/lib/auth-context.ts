/**
 * Core Kernel Auth Context API
 *
 * PLAN.md 2.4.1 / 3.1.3 に基づく認証・認可モジュールの聖域化
 */

import type { AppAuthContext } from "@takos/platform/app/services";
import type { Context } from "hono";
import { authenticateUser } from "../middleware/auth";
import { makeData } from "../data";
import { releaseStore } from "@takos/platform/server";

/**
 * AuthContext
 *
 * PLAN.md 3.1.3 で定義された認証コンテキスト
 */
export interface AuthContext {
  /** 現在のアクティブローカルユーザー（Actor）の ID */
  userId: string | null;
  /** オーナーセッション ID */
  sessionId: string | null;
  /** オーナーモードが開いているか */
  isAuthenticated: boolean;
}

/**
 * リクエストから AuthContext を取得
 *
 * @param request HTTP リクエスト（Hono Context）
 * @returns AuthContext
 */
export async function getAuthContext(c: Context): Promise<AuthContext> {
  const store = makeData(c.env as any, c);
  try {
    const authResult = await authenticateUser(c, store);

    if (!authResult) {
      return {
        userId: null,
        sessionId: null,
        isAuthenticated: false,
      };
    }

    return {
      userId: authResult.activeUserId || authResult.sessionUser?.id || null,
      sessionId: authResult.sessionId,
      isAuthenticated: true,
    };
  } finally {
    await releaseStore(store);
  }
}

/**
 * AuthContext から認証済みユーザーを要求
 *
 * @param ctx AuthContext
 * @returns userId (認証されていない場合は例外)
 * @throws Error 認証されていない場合
 */
export function requireUser(ctx: AuthContext): { userId: string } {
  if (!ctx.isAuthenticated || !ctx.userId) {
    throw new Error("Authentication required");
  }

  return { userId: ctx.userId };
}

/**
 * Hono Context を AppAuthContext に変換
 *
 * App Layer のサービスAPI呼び出しに使用
 */
export function toAppAuthContext(ctx: AuthContext): AppAuthContext {
  return {
    userId: ctx.userId,
    roles: ctx.isAuthenticated ? ["authenticated"] : [],
  };
}

/**
 * Hono Context から直接 AppAuthContext を取得（簡易版）
 *
 * 既に認証ミドルウェアを通過している場合に使用
 */
export function getAppAuthContext(c: Context): AppAuthContext {
  const user = c.get("user");
  const activeUserId = c.get("activeUserId");

  return {
    userId: activeUserId || user?.id || null,
    roles: user ? ["authenticated"] : [],
  };
}
