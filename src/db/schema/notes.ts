/**
 * Short-lived actor status notes.
 */

import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { nowIso } from "./date-utils.ts";

export const actorNotes = sqliteTable(
  "actor_notes",
  {
    actorApId: text("actor_ap_id").primaryKey(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(nowIso)
      .$onUpdateFn(nowIso),
    expiresAt: text("expires_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("actor_notes_expires_idx").on(t.expiresAt),
    index("actor_notes_updated_idx").on(t.updatedAt),
    index("actor_notes_deleted_idx").on(t.deletedAt),
  ],
);
