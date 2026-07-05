import { apiFetch, apiPost, apiPut, assertOk } from "./fetch.ts";

export async function fetchAlsoKnownAs(identifier: string): Promise<string[]> {
  const res = await apiFetch(`/api/actors/${encodeURIComponent(identifier)}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { also_known_as?: unknown };
  return Array.isArray(data.also_known_as)
    ? data.also_known_as.filter((a): a is string => typeof a === "string")
    : [];
}

export async function setAlsoKnownAs(aliases: string[]): Promise<void> {
  const res = await apiPut("/api/actors/me", { also_known_as: aliases });
  await assertOk(res, "Failed to update aliases");
}

export async function moveAccount(target: string): Promise<void> {
  const res = await apiPost("/api/actors/me/move", { target });
  await assertOk(res, "Failed to move account");
}
