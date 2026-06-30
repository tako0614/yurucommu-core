/**
 * Mobile client tables.
 */

import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { nowIsoUtc } from "./date-utils.ts";
import { actors } from "./actors.ts";

export const mobilePushRegistrations = sqliteTable(
  "mobile_push_registrations",
  {
    id: text("id").primaryKey(),
    actorApId: text("actor_ap_id")
      .notNull()
      .references(() => actors.apId),
    product: text("product").notNull(),
    token: text("token").notNull(),
    tokenHash: text("token_hash").notNull(),
    environment: text("environment").notNull().default("production"),
    hostUrl: text("host_url"),
    createdAt: text("created_at").notNull().$defaultFn(nowIsoUtc),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(nowIsoUtc)
      .$onUpdateFn(nowIsoUtc),
    lastSeenAt: text("last_seen_at").notNull().$defaultFn(nowIsoUtc),
  },
  (t) => [
    uniqueIndex("mobile_push_registrations_actor_product_token_idx").on(
      t.actorApId,
      t.product,
      t.tokenHash,
    ),
    index("mobile_push_registrations_actor_idx").on(t.actorApId),
    index("mobile_push_registrations_last_seen_idx").on(t.lastSeenAt),
  ],
);
