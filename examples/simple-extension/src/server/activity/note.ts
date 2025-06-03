import type { Note } from "../../types.ts";

export const canAcceptNote = (ctx: string, obj: unknown): boolean => {
  // Simple validation: check if it's a Note object
  return !!(
    obj &&
    typeof obj === "object" &&
    "type" in obj &&
    (obj as any).type === "Note"
  );
};

/** @activity("Note", { priority: 100, serial: true }) */
export function onReceiveNote(ctx: string, note: Note) {
  console.log("Processing ActivityPub Note:", note);

  // Store the note in KV
  if (note.id) {
    globalThis.takos?.kv.write(`note:${note.id}`, note as any);
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
}

/** @activity("Like", { priority: 50 }) */
export function onReceiveLike(ctx: string, like: any) {
  console.log("Received Like activity:", like);
  return like; // Pass through unchanged
}
