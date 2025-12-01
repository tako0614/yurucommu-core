import { makeData } from "../server/data-factory";
import { getActivityPubAvailability } from "../server/context";

export async function enqueueActivity(env: any, activity: any) {
  const availability = getActivityPubAvailability(env ?? {});
  if (!availability.enabled) {
    console.warn(
      `[ActivityPub] outbox enqueue skipped in ${availability.context} context: ${availability.reason}`,
    );
    return;
  }

  const store = makeData(env);
  try {
    await store.query(
      `INSERT INTO ap_outbox_jobs (id, activity_json, created_at) VALUES (?, ?, datetime('now'))`,
      [crypto.randomUUID(), JSON.stringify(activity)],
    );
  } finally {
    await store.disconnect?.();
  }
}
