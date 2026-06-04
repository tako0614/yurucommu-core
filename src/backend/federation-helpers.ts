// Thin re-export barrel. The federation helpers were split along their four
// unrelated seams into focused `lib/` modules; this file preserves the
// historical `../federation-helpers.ts` import surface so existing importers
// do not churn. Prefer importing directly from the focused modules in new code:
//   - URL / ActivityPub id helpers       -> ./lib/ap-ids.ts
//   - SSRF / DNS-rebinding defense        -> ./lib/ssrf.ts
//   - RSA keygen / HTTP signature signing -> ./lib/ap-signing.ts
//   - capped / timeout federation fetch   -> ./lib/federation-fetch.ts

export {
  activityApId,
  actorApId,
  communityApId,
  formatUsername,
  generateId,
  getDomain,
  isLocal,
  objectApId,
  parseLimit,
  parseOffset,
  safeJsonParse,
} from "./lib/ap-ids.ts";

export {
  assertSafeRemoteUrlResolved,
  isSafeRemoteUrl,
  normalizeRemoteDomain,
  type RemoteUrlSafetyOptions,
} from "./lib/ssrf.ts";

export { generateKeyPair, signRequest } from "./lib/ap-signing.ts";

export {
  FederationBodyTooLargeError,
  fetchWithTimeout,
} from "./lib/federation-fetch.ts";
