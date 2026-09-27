/** Candidate composition seam; product exports/bindings remain a later step. */
import type { Database } from "../../db/index.ts";
import type { EnvVars } from "../types.ts";
import { createCallHubPort } from "./call-hub-port.ts";
import { createCallDispatcher } from "./call-dispatcher.ts";
import type { CallService } from "./call-relay.ts";

export function createCallDispatcherForCalls(deps: {
  db: Database;
  env: EnvVars;
  /** Application composition resolves its declared namespace; never public HTTP. */
  actorFor(localActorApId: string): CallService;
}) {
  return createCallDispatcher({
    async send(job, signal) {
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
    async report(result, actor, signal) {
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
}
