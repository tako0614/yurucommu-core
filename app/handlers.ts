import type { TakosContext } from "@takos/platform/app/runtime";

export async function mapActivityNote(ctx: TakosContext, input?: unknown): Promise<unknown> {
  ctx.log("info", "mapActivityNote invoked", {
    hasInput: input !== undefined,
  });
  return input ?? null;
}

