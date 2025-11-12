import { makeData } from "../server/data-factory";

export async function enqueueActivity(env: any, activity: any) {
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
