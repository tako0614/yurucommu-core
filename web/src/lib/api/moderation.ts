import { apiDelete, apiFetch, apiPost, assertOk } from "./fetch.ts";

// Owner-only federation moderation surface. Mirrors the backend operator
// routes mounted at /api/moderation (see src/backend/routes/moderation.ts).
// Every call is gated server-side to the instance owner (role === "owner")
// and returns 403 otherwise; the UI also hides the entry from non-owners.

export interface BlockedDomain {
  domain: string;
  reason: string | null;
  created_at: string;
}

export interface BlockedActor {
  actor_ap_id: string;
  reason: string | null;
  created_at: string;
}

export interface ModerationReport {
  id: string;
  reporter_ap_id: string | null;
  target_ap_id: string | null;
  content: string | null;
  instance: string | null;
  created_at: string;
  resolved_at: string | null;
}

export async function fetchBlockedDomains(): Promise<BlockedDomain[]> {
  const res = await apiFetch("/api/moderation/domains");
  await assertOk(res, "Failed to fetch blocked domains");
  const data = (await res.json()) as { domains?: BlockedDomain[] };
  return data.domains || [];
}

export async function blockDomain(
  domain: string,
  reason?: string,
): Promise<void> {
  const res = await apiPost("/api/moderation/domains", { domain, reason });
  await assertOk(res, "Failed to block domain");
}

export async function unblockDomain(domain: string): Promise<void> {
  const res = await apiDelete("/api/moderation/domains", { domain });
  await assertOk(res, "Failed to unblock domain");
}

export async function fetchBlockedActors(): Promise<BlockedActor[]> {
  const res = await apiFetch("/api/moderation/actors");
  await assertOk(res, "Failed to fetch blocked actors");
  const data = (await res.json()) as { actors?: BlockedActor[] };
  return data.actors || [];
}

export async function blockActor(apId: string, reason?: string): Promise<void> {
  const res = await apiPost("/api/moderation/actors", { ap_id: apId, reason });
  await assertOk(res, "Failed to block actor");
}

export async function unblockActor(apId: string): Promise<void> {
  const res = await apiDelete("/api/moderation/actors", { ap_id: apId });
  await assertOk(res, "Failed to unblock actor");
}

export async function fetchReports(options?: {
  onlyOpen?: boolean;
}): Promise<ModerationReport[]> {
  const query = options?.onlyOpen ? "?status=open" : "";
  const res = await apiFetch(`/api/moderation/reports${query}`);
  await assertOk(res, "Failed to fetch reports");
  const data = (await res.json()) as { reports?: ModerationReport[] };
  return data.reports || [];
}

export async function resolveReport(id: string, reopen = false): Promise<void> {
  const res = await apiPost(
    `/api/moderation/reports/${encodeURIComponent(id)}/resolve`,
    { reopen },
  );
  await assertOk(res, "Failed to resolve report");
}
