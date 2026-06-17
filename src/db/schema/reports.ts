/**
 * Moderation reports table.
 *
 * Inbound `Flag` activities (federated abuse reports) are persisted here so
 * operators can review them via the moderation API instead of the report
 * being lost to a log line. Rows are append-only at ingest; an operator marks
 * a report handled by stamping `resolvedAt`.
 */

import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { nowIso } from "./date-utils.ts";

export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    // AP-ID of the actor that sent the Flag.
    reporterApId: text("reporter_ap_id").notNull(),
    // AP-ID of the reported object/actor (Flag `object`).
    targetApId: text("target_ap_id"),
    // Free-text reason carried by the Flag (`content`).
    content: text("content"),
    // Origin hostname of the reporter, for at-a-glance triage.
    instance: text("instance"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    // Stamped when an operator marks the report handled; null while open.
    resolvedAt: text("resolved_at"),
  },
  (t) => [
    index("reports_created_idx").on(t.createdAt),
    index("reports_resolved_idx").on(t.resolvedAt),
  ],
);
