import { isLocal } from "./ap-ids.ts";
import { isSafeRemoteUrl } from "./ssrf.ts";

export const MAX_REMOTE_ACTIVITY_ID_LENGTH = 2_048;

/**
 * Return whether a peer-controlled Activity id is safe to reuse in an
 * outbound protocol reference.
 *
 * HTTP-signature verification binds the envelope actor, not an arbitrary id.
 * A reusable id must therefore be a bounded, credential-free HTTP(S) URL on
 * that actor's exact URL origin. Comparing only `host` is insufficient: it
 * treats an HTTPS downgrade, a non-HTTP scheme, and credential-bearing URL
 * spellings as if the actor had authority over them.
 */
export function isTrustedRemoteActivityId(
  value: string,
  actorApId: string,
  localBaseUrl?: string,
): boolean {
  if (
    value.length === 0 ||
    value.length > MAX_REMOTE_ACTIVITY_ID_LENGTH ||
    value.trim() !== value ||
    actorApId.trim() !== actorApId ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    /[\u0000-\u001f\u007f]/u.test(actorApId) ||
    !isSafeRemoteUrl(value) ||
    !isSafeRemoteUrl(actorApId)
  ) {
    return false;
  }
  if (localBaseUrl && isLocal(value, localBaseUrl)) return false;

  try {
    return new URL(value).origin === new URL(actorApId).origin;
  } catch {
    return false;
  }
}
