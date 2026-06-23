import { apiFetch, apiPost, apiPut, assertOk } from "./fetch.ts";

// Account-level portability + migration calls. These hit the same actor
// endpoints as the profile cluster but are scoped to the Settings account
// section (data export + account migration), kept separate so this cluster
// does not edit lib/api/actors.ts.

/**
 * Trigger a download of the actor's personal-portability JSON archive.
 *
 * Fetches `/api/actors/me/export`, reads the body as a blob, and clicks a
 * synthesized anchor so the browser saves the file. The backend sets a
 * Content-Disposition filename; we mirror it with a sensible default.
 */
export async function downloadDataExport(): Promise<void> {
  const res = await apiFetch("/api/actors/me/export");
  await assertOk(res, "Failed to export data");

  const blob = await res.blob();
  const filename = parseFilename(res.headers.get("Content-Disposition"));
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoke after a tick so the click-initiated download has read the URL.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function parseFilename(disposition: string | null): string {
  const fallback = "yurucommu-export.json";
  if (!disposition) return fallback;
  const match = disposition.match(/filename="?([^"]+)"?/);
  return match?.[1] || fallback;
}

/**
 * Read the account's currently-declared aliases (alsoKnownAs) from the full
 * actor projection. `normalizeActor` drops this field, so we read the raw JSON
 * here. Needed so the alias editor can HYDRATE existing values — setAlsoKnownAs
 * is a full REPLACE, so editing without first loading them would wipe them.
 */
export async function fetchAlsoKnownAs(identifier: string): Promise<string[]> {
  const res = await apiFetch(`/api/actors/${encodeURIComponent(identifier)}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { also_known_as?: unknown };
  return Array.isArray(data.also_known_as)
    ? data.also_known_as.filter((a): a is string => typeof a === "string")
    : [];
}

/**
 * Replace the account's declared aliases (alsoKnownAs). A destination account
 * must list this account here before it can be the target of a Move.
 */
export async function setAlsoKnownAs(aliases: string[]): Promise<void> {
  const res = await apiPut("/api/actors/me", { also_known_as: aliases });
  await assertOk(res, "Failed to update aliases");
}

/**
 * Initiate an account migration: persist `movedTo` and federate Move(target)
 * to followers so they re-follow the destination.
 */
export async function moveAccount(target: string): Promise<void> {
  const res = await apiPost("/api/actors/me/move", { target });
  await assertOk(res, "Failed to move account");
}
