import type { Actor } from "../../types/index.ts";
import { normalizeActor } from "./normalize.ts";
import { apiFetch } from "./fetch.ts";

export interface RecommendedUser {
  ap_id: string;
  preferred_username: string;
  name: string | null;
  icon_url: string | null;
  username: string;
  mutual_count: number;
}

export async function fetchRecommendedUsers(): Promise<RecommendedUser[]> {
  const res = await apiFetch("/api/recommendations/users");
  if (!res.ok) return [];
  const data = (await res.json()) as { users?: RecommendedUser[] };
  return (data.users || []).map((u) => ({
    ...normalizeActor(u),
    mutual_count: u.mutual_count,
  }));
}
