import type { ActorNote } from "../../types/index.ts";
import { normalizeActorNote } from "./normalize.ts";
import { apiDelete, apiFetch, apiPost, assertOk } from "./fetch.ts";

export async function fetchNotes(): Promise<ActorNote[]> {
  const res = await apiFetch("/api/notes");
  await assertOk(res, "Failed to fetch notes");
  const data = (await res.json()) as { notes?: ActorNote[] };
  return (data.notes || []).map(normalizeActorNote);
}

export async function createNote(data: {
  content: string;
  expires_in_hours?: number;
}): Promise<ActorNote> {
  const res = await apiPost("/api/notes", data);
  await assertOk(res, "Failed to create note");
  const result = (await res.json()) as { note: ActorNote };
  return normalizeActorNote(result.note);
}

export async function deleteMyNote(): Promise<void> {
  const res = await apiDelete("/api/notes/me");
  await assertOk(res, "Failed to delete note");
}
