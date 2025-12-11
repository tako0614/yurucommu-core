/**
 * Sample Counter App Handlers
 *
 * A simple counter app demonstrating the App SDK handler pattern.
 */

interface TakosContext {
  auth: { userId: string; handle: string } | null;
  params: Record<string, string>;
  query: Record<string, string>;
  json: <T>(data: T, options?: { status?: number }) => Response;
  error: (message: string, status?: number) => Response;
  log: (level: string, message: string, data?: Record<string, unknown>) => void;
  services: {
    storage: {
      get: <T>(key: string) => Promise<T | null>;
      set: (key: string, value: unknown) => Promise<void>;
      delete: (key: string) => Promise<void>;
      list: (prefix: string) => Promise<string[]>;
    };
  };
}

interface CounterState {
  value: number;
  lastUpdated: string;
}

const COUNTER_KEY = "counter";

/**
 * Get the current counter value
 */
export async function getCounter(ctx: TakosContext): Promise<Response> {
  const state = await ctx.services.storage.get<CounterState>(COUNTER_KEY);
  const value = state?.value ?? 0;
  const lastUpdated = state?.lastUpdated ?? null;

  return ctx.json({ value, lastUpdated });
}

/**
 * Increment the counter by 1 (or specified amount)
 */
export async function incrementCounter(
  ctx: TakosContext,
  input?: { amount?: number }
): Promise<Response> {
  const amount = input?.amount ?? 1;
  const state = await ctx.services.storage.get<CounterState>(COUNTER_KEY);
  const currentValue = state?.value ?? 0;
  const newValue = currentValue + amount;
  const lastUpdated = new Date().toISOString();

  await ctx.services.storage.set(COUNTER_KEY, { value: newValue, lastUpdated });

  return ctx.json({ value: newValue, previousValue: currentValue, lastUpdated });
}

/**
 * Decrement the counter by 1 (or specified amount)
 */
export async function decrementCounter(
  ctx: TakosContext,
  input?: { amount?: number }
): Promise<Response> {
  const amount = input?.amount ?? 1;
  const state = await ctx.services.storage.get<CounterState>(COUNTER_KEY);
  const currentValue = state?.value ?? 0;
  const newValue = currentValue - amount;
  const lastUpdated = new Date().toISOString();

  await ctx.services.storage.set(COUNTER_KEY, { value: newValue, lastUpdated });

  return ctx.json({ value: newValue, previousValue: currentValue, lastUpdated });
}

/**
 * Reset the counter to 0
 */
export async function resetCounter(ctx: TakosContext): Promise<Response> {
  const state = await ctx.services.storage.get<CounterState>(COUNTER_KEY);
  const previousValue = state?.value ?? 0;
  const lastUpdated = new Date().toISOString();

  await ctx.services.storage.set(COUNTER_KEY, { value: 0, lastUpdated });

  return ctx.json({ value: 0, previousValue, lastUpdated });
}

/**
 * Set the counter to a specific value
 */
export async function setCounter(
  ctx: TakosContext,
  input?: { value?: number }
): Promise<Response> {
  if (input?.value === undefined) {
    return ctx.error("value is required", 400);
  }

  const state = await ctx.services.storage.get<CounterState>(COUNTER_KEY);
  const previousValue = state?.value ?? 0;
  const newValue = input.value;
  const lastUpdated = new Date().toISOString();

  await ctx.services.storage.set(COUNTER_KEY, { value: newValue, lastUpdated });

  return ctx.json({ value: newValue, previousValue, lastUpdated });
}

/**
 * Get app info (no auth required)
 */
export async function getAppInfo(ctx: TakosContext): Promise<Response> {
  return ctx.json({
    id: "sample-counter",
    name: "Sample Counter",
    version: "1.0.0",
    description: "A simple counter app demonstrating the App SDK",
  });
}
