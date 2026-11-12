import type { Database } from "../../../db/index.ts";
import { isActorBlockedStrict } from "../blocklist.ts";
import { personalActorIsBlockedBy } from "../personal-actor-moderation.ts";

/** Current outgoing-call moderation policy; authority lookup failures propagate. */
export async function outgoingCallIsAllowed(
  db: Database,
  localActorApId: string,
  peerApId: string,
): Promise<boolean> {
  return (
    !(await isActorBlockedStrict(db, peerApId)) &&
    !(await personalActorIsBlockedBy(db, localActorApId, peerApId))
  );
}
