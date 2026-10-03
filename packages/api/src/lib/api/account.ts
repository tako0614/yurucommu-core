import {
  readResponseJson,
  requiredArray,
  responseObject,
  requiredString,
  validateActor,
} from "./response.ts";
import type { ApiReadOptions } from "./fetch.ts";
import { apiFetch, apiPost, apiPut, assertOk } from "./fetch.ts";

export async function fetchAlsoKnownAs(
  identifier: string,
  options?: ApiReadOptions,
): Promise<string[]> {
  const res = await apiFetch(
    `/api/actors/${encodeURIComponent(identifier)}`,
    options,
  );
  await assertOk(res, "Failed to load aliases");
  const data = await readResponseJson(res);
  validateActor(data.actor);
  const actor = responseObject(data.actor, "actor");
  // Public Actor metadata is additive; older servers can omit aliases.
  if (actor.also_known_as === undefined) return [];
  return requiredArray<string>(actor, "also_known_as", (value) => {
    requiredString(value, "also_known_as entry");
  });
}

export async function setAlsoKnownAs(aliases: string[]): Promise<void> {
  const res = await apiPut("/api/actors/me", { also_known_as: aliases });
  await assertOk(res, "Failed to update aliases");
}

export async function moveAccount(target: string): Promise<void> {
  const res = await apiPost("/api/actors/me/move", { target });
  await assertOk(res, "Failed to move account");
}
