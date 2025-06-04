import type { Note } from "../../types.ts";
import { SerializableObject, ServerExtension } from "@takopack/builder";

const NoteActivity = new ServerExtension();

NoteActivity.canAcceptNote = (_ctx: string, obj: unknown): boolean => {
  // Simple validation: check if it's a Note object
  return !!(
    obj &&
    typeof obj === "object" &&
    "type" in obj &&
    (obj as Record<string, unknown>).type === "Note"
  );
};

/** @activity("Note", { priority: 100, serial: true }) */
NoteActivity.onReceiveNote = (
  _ctx: string,
  note: Note,
) => {
  console.log("Processing ActivityPub Note:", note);

  // Store the note in KV
  if (note.id) {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).takos?.kv.write(
      `note:${note.id}`,
      note as unknown as SerializableObject,
    );
  }

  // Process mentions or hashtags if needed
  if (note.content?.includes("#takopack")) {
    console.log("Found #takopack mention in note!");
  }

  return {
    status: "processed",
    timestamp: Date.now(),
    processed_by: "simple-extension",
  };
};

/** @activity("Like", { priority: 50 }) */
NoteActivity.onReceiveLike = (
  _ctx: string,
  like: SerializableObject,
) => {
  console.log("Received Like activity:", like);
  return like; // Pass through unchanged
};

export { NoteActivity };
