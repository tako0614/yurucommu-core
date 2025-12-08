/**
 * Core Kernel Auth Context API
 *
 * PLAN.md 2.4.1 / 3.1.3 に基づく認証・認可モジュールの聖域化
 */

import type { AppAuthContext } from "@takos/platform/app/services";
import type { Context } from "hono";
import { authenticateUser } from "../middleware/auth";
import { makeData } from "../data";
import { HttpError, releaseStore } from "@takos/platform/server";
import type { AuthContext, LocalUser } from "./auth-context-model";
import { buildAuthContext, resolvePlanFromEnv } from "./auth-context-model";
export type { AuthContext, LocalUser, PlanInfo, AuthenticatedUser } from "./auth-context-model";

/**
 * リクエストから AuthContext を取得
 *
 * @param request HTTP リクエスト（Hono Context）
 * @returns AuthContext
 */
export async function getAuthContext(c: Context): Promise<AuthContext> {
  const plan = resolvePlanFromEnv(c.env as any);
  const store = makeData(c.env as any, c);
  try {
    const authResult = await authenticateUser(c, store);
    return buildAuthContext(authResult, plan);
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
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
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
  const limits = ctx.limits ?? ctx.plan?.limits;
  return {
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    roles: ctx.isAuthenticated ? ["authenticated"] : [],
    isAuthenticated: ctx.isAuthenticated,
    plan: ctx.plan,
    limits,
    rateLimits: limits?.apiRateLimits,
    user: ctx.user,
  };
}

export function createAnonymousAppAuthContext(env: Record<string, unknown> | undefined): AppAuthContext {
  const plan = resolvePlanFromEnv(env);
  return toAppAuthContext(buildAuthContext(null, plan));
}

export function createAppAuthContextForUser(
  env: Record<string, unknown> | undefined,
  userId: string | null,
  options: { user?: LocalUser | null; sessionId?: string | null; roles?: string[]; isAuthenticated?: boolean } = {},
): AppAuthContext {
  const plan = resolvePlanFromEnv(env);
  const auth = userId
    ? buildAuthContext(
        {
          user: options.user ?? { id: userId, handle: userId, name: null, avatar: null, bio: null, createdAt: null },
          sessionUser: options.user ?? { id: userId },
          activeUserId: userId,
          sessionId: options.sessionId ?? null,
          token: null,
        },
        plan,
      )
    : buildAuthContext(null, plan);
  const appCtx = toAppAuthContext(auth);
  if (options.roles?.length) {
    appCtx.roles = options.roles;
  }
  if (options.isAuthenticated === false) {
    appCtx.isAuthenticated = false;
  }
  return appCtx;
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
      )
    : buildAuthContext(null, plan);

  return toAppAuthContext(derived);
}
