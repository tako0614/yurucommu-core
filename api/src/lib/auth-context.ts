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
import type { AuthContext, LocalUser } from "./auth-context-model";
import { buildAuthContext, resolvePlanFromEnv, resolveRateLimits } from "./auth-context-model";
export type { AuthContext, LocalUser, PlanInfo, AuthRateLimits, AuthenticatedUser } from "./auth-context-model";

/**
 * リクエストから AuthContext を取得
 *
 * @param request HTTP リクエスト（Hono Context）
 * @returns AuthContext
 */
export async function getAuthContext(c: Context): Promise<AuthContext> {
  const plan = resolvePlanFromEnv(c.env as any);
  const rateLimits = resolveRateLimits(plan);
  const store = makeData(c.env as any, c);
  try {
    const authResult = await authenticateUser(c, store);
    return buildAuthContext(authResult, plan, rateLimits);
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
export function requireUser(ctx: AuthContext): { userId: string; user: LocalUser } {
  if (!ctx.isAuthenticated || !ctx.userId) {
    throw new Error("Authentication required");
  }

  const user =
    ctx.user ??
    ({
      id: ctx.userId,
      handle: null,
      name: null,
      avatar: null,
      bio: null,
      createdAt: null,
    } satisfies LocalUser);

  return { userId: ctx.userId, user };
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
    isAuthenticated: ctx.isAuthenticated,
    sessionId: ctx.sessionId,
    plan: ctx.plan,
    rateLimits: ctx.rateLimits,
    user: ctx.user,
  };
}

/**
 * Hono Context から直接 AppAuthContext を取得（簡易版）
 *
 * 既に認証ミドルウェアを通過している場合に使用
 */
export function getAppAuthContext(c: Context): AppAuthContext {
  const existing = c.get("authContext") as AuthContext | undefined;
  if (existing) {
    return toAppAuthContext(existing);
  }

  const plan = resolvePlanFromEnv(c.env as any);
  const rateLimits = resolveRateLimits(plan);
  const user = c.get("user");
  const activeUserId = c.get("activeUserId");

  const derived = user
    ? buildAuthContext(
        {
          user,
          sessionUser: user,
          activeUserId: activeUserId || user?.id || null,
          sessionId: null,
          token: null,
        },
        plan,
        rateLimits,
      )
    : buildAuthContext(null, plan, rateLimits);

  return toAppAuthContext(derived);
}
