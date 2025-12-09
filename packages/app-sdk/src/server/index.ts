import type { HandlerConfig } from "../types";

// Server-facing exports
export * from "../types";

export function defineHandler<TInput = unknown, TOutput = unknown>(
  config: HandlerConfig<TInput, TOutput>
): HandlerConfig<TInput, TOutput> {
  return config;
}
