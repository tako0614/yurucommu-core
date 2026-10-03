import {
  readResponseJson,
  requiredArray,
  requiredCount,
  responseObject,
  validateActor,
} from "./response.ts";
import type { ApiReadOptions } from "./fetch.ts";
import { normalizeActor } from "./normalize.ts";
import { apiFetch, assertOk } from "./fetch.ts";

export interface RecommendedUser {
  ap_id: string;
  preferred_username: string;
  name: string | null;
  icon_url: string | null;
  username: string;
  mutual_count: number;
}

export function fetchRecommendedUsers(): Promise<RecommendedUser[]>;
export function fetchRecommendedUsers(
  options: ApiReadOptions,
): Promise<RecommendedUser[]>;
export async function fetchRecommendedUsers(
  options?: ApiReadOptions,
): Promise<RecommendedUser[]> {
  const res = await apiFetch("/api/recommendations/users", options);
  await assertOk(res, "Failed to load recommended users");
  const data = await readResponseJson(res);
  return requiredArray<RecommendedUser>(data, "users", (value) => {
    validateActor(value);
    requiredCount(responseObject(value).mutual_count, "mutual_count");
  }).map((u) => ({
    ...normalizeActor(u),
    mutual_count: u.mutual_count,
  }));
}
