// Clamp + normalize a remote-controlled timestamp (inbound AP `published`).
// Stored verbatim it poisons the `desc(published)` feed/chat sort + the
// `lt(published, cursor)` paginator two ways: (1) a non-ISO / space-separated /
// non-`Z` value lexically mis-sorts under SQLite BINARY collation; (2) a VALID
// but far-FUTURE value ("9999-…") legitimately parses yet lexically dominates
// every real `2026-…` row, pinning the row to the top of every feed forever. So:
// reformat to the canonical ISO-8601 UTC shape every comparison operand uses,
// AND clamp a future date down to `now` (a post cannot be published in the
// future; a small skew slack is allowed). Garbage / missing → `now`. We do NOT
// clamp the past — legitimately old (backfilled) posts exist and merely sink.
// (Mirrors the `endTime` clamp already applied to inbound stories.)
//
// Shared by every inbound Note path — handleCreate / insertDirectNote /
// handleCreateStory (inbox-content-handlers) AND handleGroupCreate
// (actor-inbox-handlers, the federated community-chat path) — so none can skip it.
export const FUTURE_PUBLISHED_SKEW_MS = 5 * 60 * 1000;

export function normalizeInboundTimestamp(
  raw: string | null | undefined,
  fallbackNow: string,
): string {
  const nowMs = Date.parse(fallbackNow);
  const ms = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(ms)) return fallbackNow;
  if (Number.isFinite(nowMs) && ms > nowMs + FUTURE_PUBLISHED_SKEW_MS) {
    return fallbackNow;
  }
  return new Date(ms).toISOString();
}
