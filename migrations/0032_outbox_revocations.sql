-- Public publication withdrawal is separate from the retained Activity ledger.
-- No object or actor FK: remote targets and history survive object deletion.
-- Existing unknown-object Announces cannot be classified safely; no backfill.
CREATE TABLE IF NOT EXISTS outbox_revocations (
  activity_ap_id TEXT PRIMARY KEY NOT NULL
);

-- Commit publication withdrawal with the actual object deletion, across every
-- deletion entrypoint. Do not UPDATE activities: another actor's deletion
-- reservation may protect its retained boost. Direction is deliberately not
-- tested, so legacy user reposts with NULL direction are withdrawn too.
CREATE TRIGGER IF NOT EXISTS outbox_revocations_after_object_delete
AFTER DELETE ON objects
BEGIN
  INSERT OR IGNORE INTO outbox_revocations (activity_ap_id)
    SELECT ap_id FROM activities
    WHERE object_ap_id = OLD.ap_id
      AND type IN ('Create', 'Update', 'Announce');
END;

-- An Activity hard delete (including normal unrepost) ends its history lifetime.
-- Recreating an object never clears the old Activity's withdrawal.
CREATE TRIGGER IF NOT EXISTS outbox_revocations_after_activity_delete
AFTER DELETE ON activities
BEGIN
  DELETE FROM outbox_revocations WHERE activity_ap_id = OLD.ap_id;
END;
