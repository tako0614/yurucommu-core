/** Candidate composition seam; product exports/bindings remain a later step. */
import type { Database } from "../../db/index.ts";
import type { EnvVars } from "../types.ts";
import { createCallHubPort } from "./call-hub-port.ts";
import { createCallDispatcher } from "./call-dispatcher.ts";
import type { CallService } from "./call-relay.ts";

export interface CallDispatcherForCallsDependencies {
  db: Database;
  env: EnvVars;
  /** Application composition resolves its declared namespace; never public HTTP. */
  actorFor(localActorApId: string): CallService;
}

/**
 * One admission budget per dispatcher, with bindings captured for each accepted
 * invocation. A Host may provide a fresh env object on every fetch; neither
 * object identity nor a prior invocation's binding-handle lifetime is assumed.
 */
export function createCallDispatcherForCallsByInvocation() {
  const dispatcher = createCallDispatcher<CallDispatcherForCallsDependencies>({
    async send(job, signal, deps) {
      if (!deps)
        throw new Error("RTC dispatcher invocation is missing bindings");
      // Reuse the existing local-key lookup, signing, endpoint discovery and
      // SSRF path. Only a real peer response resolves sendToPeer successfully.
      const port = createCallHubPort({
        db: deps.db,
        env: deps.env,
        localActorApId: job.envelope.from,
        broadcast: () => {},
        hasClients: () => false,
        signalBudget: { signal, deadline: job.effect.deadline },
      });
      await port.sendToPeer(job.envelope, job.peerSignalEndpoint);
    },
    async report(result, actor, signal, deps) {
      if (!deps)
        throw new Error("RTC dispatcher invocation is missing bindings");
      if (signal.aborted) throw signal.reason;
      const response = await deps.actorFor(actor).fetch(
        new Request("https://call-actor/_relay-result", {
          method: "POST",
          signal,
          body: JSON.stringify(result),
        }),
      );
      await response.body?.cancel();
      if (response.status !== 204)
        throw new Error("RTC result callback refused");
    },
  });
  return {
    fetch(
      request: Request,
      context: { waitUntil(promise: Promise<unknown>): void },
      deps: CallDispatcherForCallsDependencies,
    ): Promise<Response> {
      return dispatcher.fetch(request, context, deps);
    },
  };
}

/** Existing static composition remains source-compatible for other callers. */
export function createCallDispatcherForCalls(
  deps: CallDispatcherForCallsDependencies,
) {
  const dispatcher = createCallDispatcherForCallsByInvocation();
  return {
    fetch(
      request: Request,
      context: { waitUntil(promise: Promise<unknown>): void },
    ): Promise<Response> {
      return dispatcher.fetch(request, context, deps);
    },
  };
}
