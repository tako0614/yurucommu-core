/**
 * Sample Counter App - Handlers
 *
 * Minimal handler implementation to test the App SDK server-side pipeline.
 * Demonstrates:
 * - Reading/writing App State (KV storage)
 * - Authentication-required handlers
 * - Public handlers
 */

import type { AppHandler, TakosContext, AppAuthContext } from "@takos/platform/app";

// In-memory counter storage (in production, use ctx.services.storage or KV)
const counters = new Map<string, number>();

function requireAuth(ctx: TakosContext): AppAuthContext & { userId: string } {
  if (!ctx.auth?.userId) {
    throw { type: "error", status: 401, message: "authentication required" };
  }
  return ctx.auth as AppAuthContext & { userId: string };
}

// ============================================================================
// Counter Handlers
// ============================================================================

/**
 * Get the current counter value for the authenticated user
 */
export const getCounter: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  ctx.log("info", "getCounter", { userId: auth.userId });

  const value = counters.get(auth.userId) ?? 0;
  return ctx.json({ value, userId: auth.userId });
};

/**
 * Increment the counter for the authenticated user
 */
export const incrementCounter: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  ctx.log("info", "incrementCounter", { userId: auth.userId });

  const current = counters.get(auth.userId) ?? 0;
  const newValue = current + 1;
  counters.set(auth.userId, newValue);

  return ctx.json({ value: newValue, userId: auth.userId });
};

/**
 * Decrement the counter for the authenticated user
 */
export const decrementCounter: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  ctx.log("info", "decrementCounter", { userId: auth.userId });

  const current = counters.get(auth.userId) ?? 0;
  const newValue = current - 1;
  counters.set(auth.userId, newValue);

  return ctx.json({ value: newValue, userId: auth.userId });
};

/**
 * Reset the counter to zero
 */
export const resetCounter: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  ctx.log("info", "resetCounter", { userId: auth.userId });

  counters.set(auth.userId, 0);

  return ctx.json({ value: 0, userId: auth.userId });
};

/**
 * Set the counter to a specific value
 */
export const setCounter: AppHandler = async (ctx, input) => {
  const auth = requireAuth(ctx);
  const { value } = (input as { value?: number }) ?? {};
  ctx.log("info", "setCounter", { userId: auth.userId, value });

  if (typeof value !== "number") {
    return ctx.error("value must be a number", 400);
  }

  counters.set(auth.userId, value);

  return ctx.json({ value, userId: auth.userId });
};

/**
 * Get app info (public endpoint)
 */
export const getAppInfo: AppHandler = async (ctx, input) => {
  ctx.log("info", "getAppInfo");

  return ctx.json({
    name: "sample-counter",
    version: "0.1.0",
    description: "A minimal sample app to test the App SDK pipeline",
  });
};

// ============================================================================
// Handler Registry Export
// ============================================================================

const handlers: Record<string, AppHandler> = {
  getCounter,
  incrementCounter,
  decrementCounter,
  resetCounter,
  setCounter,
  getAppInfo,
};

export { handlers };
export default handlers;
