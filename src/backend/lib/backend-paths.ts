// Backend route prefixes (API, ActivityPub, well-known, nodeinfo, media, health,
// tools, hosted). A request under one of these that reaches the static-asset /
// SPA fallback means the backend router did NOT match it — that is a genuine
// 404 for an API / AP / media client, NOT a candidate for the SPA HTML fallback
// (which would return 200 text/html and break clients that expect JSON or an AP
// document).
//
// This is the SINGLE source of truth shared by every runtime's static fallback
// (the Bun BunAssets handler and the Cloudflare Workers `mountStaticFallback`),
// so the two cannot diverge — they previously did: the Bun path guarded these
// prefixes while the Cloudflare path forwarded everything to ASSETS, so an
// unmatched /api/* returned the SPA HTML shell (200) on the production worker.
export const NON_SPA_PREFIXES = [
  "/api",
  "/ap",
  "/.well-known",
  "/nodeinfo",
  "/media",
  "/hosted",
  "/.takos",
  "/healthz",
  "/readyz",
] as const;

/**
 * True when `pathname` is under a backend route prefix — exact match or a
 * `/prefix/...` child. Used to refuse the SPA HTML fallback for unmatched
 * backend routes so they 404 (JSON) instead of returning the app shell.
 */
export function isBackendPath(pathname: string): boolean {
  return NON_SPA_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}
