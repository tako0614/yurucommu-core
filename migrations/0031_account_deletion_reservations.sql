-- A deletion reservation survives worker lease expiry. The root and every
-- persona are claimed in the same atomic batch before any destructive work.
-- These tables intentionally have no actor FK: an actor tombstone or old
-- installation with historical FK layout must not cascade away retry authority.
CREATE TABLE IF NOT EXISTS account_deletions (
  id TEXT PRIMARY KEY NOT NULL,
  root_actor_ap_id TEXT NOT NULL,
  root_public_key_pem TEXT NOT NULL,
  worker_token TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS account_deletions_root_idx
  ON account_deletions(root_actor_ap_id);

CREATE TABLE IF NOT EXISTS account_deletion_targets (
  actor_ap_id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL,
  public_key_pem TEXT NOT NULL,
  followers_url TEXT NOT NULL,
  delete_activity_ap_id TEXT NOT NULL,
  cascade_complete INTEGER NOT NULL DEFAULT 0 CHECK (cascade_complete IN (0, 1))
);

CREATE INDEX IF NOT EXISTS account_deletion_targets_operation_idx
  ON account_deletion_targets(operation_id);

-- Indirect references remain reserved after an authored object is hard-deleted.
-- Keep this snapshot until the same final batch releases the actor targets.
CREATE TABLE IF NOT EXISTS account_deletion_object_targets (
  object_ap_id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS account_deletion_object_targets_operation_idx
  ON account_deletion_object_targets(operation_id);

-- Preserve the immutable blob key before an external put can start. A putting
-- row must survive until the writer settles; time cannot fence a late put.
CREATE TABLE IF NOT EXISTS media_upload_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  r2_key TEXT NOT NULL,
  uploader_ap_id TEXT NOT NULL,
  public_key_pem TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('putting', 'cleanup')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS media_upload_attempts_r2_key_idx
  ON media_upload_attempts(r2_key);

CREATE INDEX IF NOT EXISTS media_upload_attempts_uploader_idx
  ON media_upload_attempts(uploader_ap_id);

-- This insert is the admission check, including the uploader's parent.
CREATE TRIGGER IF NOT EXISTS media_upload_attempts_insert
BEFORE INSERT ON media_upload_attempts
WHEN NEW.phase <> 'putting' OR NOT EXISTS (
  SELECT 1 FROM actors AS actor
  WHERE actor.ap_id = NEW.uploader_ap_id
    AND actor.public_key_pem = NEW.public_key_pem
    AND actor.deleted_at IS NULL
) OR EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE target.actor_ap_id = NEW.uploader_ap_id
    OR target.actor_ap_id = (
      SELECT actor.owner_actor_ap_id FROM actors AS actor
      WHERE actor.ap_id = NEW.uploader_ap_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

-- Identity is immutable. Only the writer that observed put settlement may
-- transition putting to cleanup; cleanup never becomes putting again.
CREATE TRIGGER IF NOT EXISTS media_upload_attempts_update
BEFORE UPDATE ON media_upload_attempts
WHEN NEW.id IS NOT OLD.id
  OR NEW.r2_key IS NOT OLD.r2_key
  OR NEW.uploader_ap_id IS NOT OLD.uploader_ap_id
  OR NEW.public_key_pem IS NOT OLD.public_key_pem
  OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.phase IS NOT OLD.phase
    AND NOT (OLD.phase = 'putting' AND NEW.phase = 'cleanup'))
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

-- No worker may discard the only identity of an in-flight external write.
-- Cleanup-row deletion is the caller's acknowledgment of external success.
CREATE TRIGGER IF NOT EXISTS media_upload_attempts_delete
BEFORE DELETE ON media_upload_attempts
WHEN OLD.phase <> 'cleanup'
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

-- The request/cascade writer inserts a witness before its payload and deletes
-- it as the last statement of that same atomic batch. A missing/stale lease or
-- observed actor key must produce NULL in the scalar witness expression;
-- NOT NULL then ABORTs the whole batch. A zero-row INSERT is not an assertion.
-- operation_id is set only for an authorized deletion worker. Normal request
-- assertions use NULL and cannot bypass reserved-target triggers.
CREATE TABLE IF NOT EXISTS actor_write_assertions (
  id TEXT PRIMARY KEY NOT NULL,
  witness INTEGER NOT NULL,
  operation_id TEXT
);

CREATE INDEX IF NOT EXISTS actor_write_assertions_operation_idx
  ON actor_write_assertions(operation_id);

-- A marker is a transaction-local effect despite residing in an ordinary
-- table: INSERT, payload, DELETE are committed or rolled back as one db.batch.
-- Triggers below match its operation_id to the exact reserved target. The
-- application must never publish a marker outside that bounded atomic batch.

-- Freeze target-owned rows and direct relationship edges while reserved.
-- The marker bypass is scoped to the same operation as the target row.
-- The object snapshot also fences indirect interactions after hard deletion.
-- Missing-parent races after release need a same-statement parent check in writers.

CREATE TRIGGER IF NOT EXISTS account_deletion_sessions_insert
BEFORE INSERT ON sessions
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.member_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_sessions_update
BEFORE UPDATE ON sessions
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.member_id)
    OR target.actor_ap_id IN (NEW.member_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_sessions_delete
BEFORE DELETE ON sessions
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.member_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_objects_insert
BEFORE INSERT ON objects
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE target.actor_ap_id = NEW.attributed_to
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
) OR EXISTS (
  SELECT 1 FROM account_deletion_object_targets AS reserved
  WHERE reserved.object_ap_id IN (NEW.ap_id, NEW.in_reply_to)
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = reserved.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_objects_update
BEFORE UPDATE ON objects
WHEN (
    NEW.ap_id IS NOT OLD.ap_id
    OR NEW.type IS NOT OLD.type
    OR NEW.attributed_to IS NOT OLD.attributed_to
    OR NEW.content IS NOT OLD.content
    OR NEW.summary IS NOT OLD.summary
    OR NEW.attachments_json IS NOT OLD.attachments_json
    OR NEW.in_reply_to IS NOT OLD.in_reply_to
    OR NEW.conversation IS NOT OLD.conversation
    OR NEW.visibility IS NOT OLD.visibility
    OR NEW.to_json IS NOT OLD.to_json
    OR NEW.cc_json IS NOT OLD.cc_json
    OR NEW.audience_json IS NOT OLD.audience_json
    OR NEW.tags_json IS NOT OLD.tags_json
    OR NEW.community_ap_id IS NOT OLD.community_ap_id
    OR NEW.end_time IS NOT OLD.end_time
    OR NEW.published IS NOT OLD.published
    OR NEW.updated IS NOT OLD.updated
    OR NEW.is_local IS NOT OLD.is_local
    OR NEW.raw_json IS NOT OLD.raw_json
    OR NEW.deleted_at IS NOT OLD.deleted_at
) AND (
  EXISTS (
    SELECT 1 FROM account_deletion_targets AS target
    WHERE target.actor_ap_id IN (OLD.attributed_to, NEW.attributed_to)
      AND NOT EXISTS (
        SELECT 1 FROM actor_write_assertions AS marker
        WHERE marker.operation_id = target.operation_id
      )
  ) OR EXISTS (
    SELECT 1 FROM account_deletion_object_targets AS reserved
    WHERE reserved.object_ap_id IN (
      OLD.ap_id, NEW.ap_id, OLD.in_reply_to, NEW.in_reply_to
    )
      AND NOT EXISTS (
        SELECT 1 FROM actor_write_assertions AS marker
        WHERE marker.operation_id = reserved.operation_id
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_objects_delete
BEFORE DELETE ON objects
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.attributed_to))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_communities_insert
BEFORE INSERT ON communities
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.created_by))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_communities_update
BEFORE UPDATE ON communities
WHEN NEW.created_by IS NOT OLD.created_by AND EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.created_by)
    OR target.actor_ap_id IN (NEW.created_by))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_communities_delete
BEFORE DELETE ON communities
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.created_by))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_follows_insert
BEFORE INSERT ON follows
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.follower_ap_id, NEW.following_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_follows_update
BEFORE UPDATE ON follows
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.follower_ap_id, OLD.following_ap_id)
    OR target.actor_ap_id IN (NEW.follower_ap_id, NEW.following_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_follows_delete
BEFORE DELETE ON follows
WHEN EXISTS (
  SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.follower_ap_id, OLD.following_ap_id)
) AND NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id IN (
      SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.follower_ap_id, OLD.following_ap_id)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_likes_insert
BEFORE INSERT ON likes
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE ((target.actor_ap_id IN (NEW.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = NEW.object_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = NEW.object_ap_id
        AND reserved.operation_id = target.operation_id
    )))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_likes_update
BEFORE UPDATE ON likes
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE ((target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = OLD.object_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.object_ap_id
        AND reserved.operation_id = target.operation_id
    ))
    OR (target.actor_ap_id IN (NEW.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = NEW.object_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = NEW.object_ap_id
        AND reserved.operation_id = target.operation_id
    )))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_likes_delete
BEFORE DELETE ON likes
WHEN EXISTS (
  SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id)
      UNION
      SELECT reserved.operation_id FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.object_ap_id
) AND NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id IN (
      SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id)
      UNION
      SELECT reserved.operation_id FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.object_ap_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_announces_insert
BEFORE INSERT ON announces
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE ((target.actor_ap_id IN (NEW.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = NEW.object_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = NEW.object_ap_id
        AND reserved.operation_id = target.operation_id
    )))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_announces_update
BEFORE UPDATE ON announces
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE ((target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = OLD.object_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.object_ap_id
        AND reserved.operation_id = target.operation_id
    ))
    OR (target.actor_ap_id IN (NEW.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = NEW.object_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = NEW.object_ap_id
        AND reserved.operation_id = target.operation_id
    )))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_announces_delete
BEFORE DELETE ON announces
WHEN EXISTS (
  SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id)
      UNION
      SELECT reserved.operation_id FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.object_ap_id
) AND NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id IN (
      SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id)
      UNION
      SELECT reserved.operation_id FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.object_ap_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_bookmarks_insert
BEFORE INSERT ON bookmarks
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE ((target.actor_ap_id IN (NEW.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = NEW.object_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = NEW.object_ap_id
        AND reserved.operation_id = target.operation_id
    )))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_bookmarks_update
BEFORE UPDATE ON bookmarks
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE ((target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = OLD.object_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.object_ap_id
        AND reserved.operation_id = target.operation_id
    ))
    OR (target.actor_ap_id IN (NEW.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = NEW.object_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = NEW.object_ap_id
        AND reserved.operation_id = target.operation_id
    )))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_bookmarks_delete
BEFORE DELETE ON bookmarks
WHEN EXISTS (
  SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id)
      UNION
      SELECT reserved.operation_id FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.object_ap_id
) AND NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id IN (
      SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id)
      UNION
      SELECT reserved.operation_id FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.object_ap_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_object_recipients_insert
BEFORE INSERT ON object_recipients
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE ((target.actor_ap_id IN (NEW.recipient_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = NEW.object_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = NEW.object_ap_id
        AND reserved.operation_id = target.operation_id
    )))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_object_recipients_update
BEFORE UPDATE ON object_recipients
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE ((target.actor_ap_id IN (OLD.recipient_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = OLD.object_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.object_ap_id
        AND reserved.operation_id = target.operation_id
    ))
    OR (target.actor_ap_id IN (NEW.recipient_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = NEW.object_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = NEW.object_ap_id
        AND reserved.operation_id = target.operation_id
    )))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_object_recipients_delete
BEFORE DELETE ON object_recipients
WHEN EXISTS (
  SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.recipient_ap_id)
      UNION
      SELECT reserved.operation_id FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.object_ap_id
) AND NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id IN (
      SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.recipient_ap_id)
      UNION
      SELECT reserved.operation_id FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.object_ap_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_blocks_insert
BEFORE INSERT ON blocks
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.blocker_ap_id, NEW.blocked_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_blocks_update
BEFORE UPDATE ON blocks
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.blocker_ap_id, OLD.blocked_ap_id)
    OR target.actor_ap_id IN (NEW.blocker_ap_id, NEW.blocked_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_blocks_delete
BEFORE DELETE ON blocks
WHEN EXISTS (
  SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.blocker_ap_id, OLD.blocked_ap_id)
) AND NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id IN (
      SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.blocker_ap_id, OLD.blocked_ap_id)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_mutes_insert
BEFORE INSERT ON mutes
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.muter_ap_id, NEW.muted_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_mutes_update
BEFORE UPDATE ON mutes
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.muter_ap_id, OLD.muted_ap_id)
    OR target.actor_ap_id IN (NEW.muter_ap_id, NEW.muted_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_mutes_delete
BEFORE DELETE ON mutes
WHEN EXISTS (
  SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.muter_ap_id, OLD.muted_ap_id)
) AND NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id IN (
      SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.muter_ap_id, OLD.muted_ap_id)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_activities_insert
BEFORE INSERT ON activities
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_activities_update
BEFORE UPDATE ON activities
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_activities_delete
BEFORE DELETE ON activities
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_inbox_insert
BEFORE INSERT ON inbox
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_inbox_update
BEFORE UPDATE ON inbox
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_inbox_delete
BEFORE DELETE ON inbox
WHEN EXISTS (
  SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id)
      UNION
      SELECT target.operation_id FROM account_deletion_targets AS target
      JOIN activities AS activity ON activity.actor_ap_id = target.actor_ap_id
      WHERE activity.ap_id = OLD.activity_ap_id
) AND NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id IN (
      SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id)
      UNION
      SELECT target.operation_id FROM account_deletion_targets AS target
      JOIN activities AS activity ON activity.actor_ap_id = target.actor_ap_id
      WHERE activity.ap_id = OLD.activity_ap_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_notification_archived_insert
BEFORE INSERT ON notification_archived
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_notification_archived_update
BEFORE UPDATE ON notification_archived
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_notification_archived_delete
BEFORE DELETE ON notification_archived
WHEN EXISTS (
  SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id)
      UNION
      SELECT target.operation_id FROM account_deletion_targets AS target
      JOIN activities AS activity ON activity.actor_ap_id = target.actor_ap_id
      WHERE activity.ap_id = OLD.activity_ap_id
) AND NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id IN (
      SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id)
      UNION
      SELECT target.operation_id FROM account_deletion_targets AS target
      JOIN activities AS activity ON activity.actor_ap_id = target.actor_ap_id
      WHERE activity.ap_id = OLD.activity_ap_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_dm_typing_insert
BEFORE INSERT ON dm_typing
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.actor_ap_id, NEW.recipient_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_dm_typing_update
BEFORE UPDATE ON dm_typing
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id, OLD.recipient_ap_id)
    OR target.actor_ap_id IN (NEW.actor_ap_id, NEW.recipient_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_dm_typing_delete
BEFORE DELETE ON dm_typing
WHEN EXISTS (
  SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id, OLD.recipient_ap_id)
) AND NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id IN (
      SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id, OLD.recipient_ap_id)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_dm_read_status_insert
BEFORE INSERT ON dm_read_status
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_dm_read_status_update
BEFORE UPDATE ON dm_read_status
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_dm_read_status_delete
BEFORE DELETE ON dm_read_status
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_dm_community_read_status_insert
BEFORE INSERT ON dm_community_read_status
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_dm_community_read_status_update
BEFORE UPDATE ON dm_community_read_status
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_dm_community_read_status_delete
BEFORE DELETE ON dm_community_read_status
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_dm_archived_conversations_insert
BEFORE INSERT ON dm_archived_conversations
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_dm_archived_conversations_update
BEFORE UPDATE ON dm_archived_conversations
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_dm_archived_conversations_delete
BEFORE DELETE ON dm_archived_conversations
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_media_uploads_insert
BEFORE INSERT ON media_uploads
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.uploader_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_media_uploads_update
BEFORE UPDATE ON media_uploads
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.uploader_ap_id)
    OR target.actor_ap_id IN (NEW.uploader_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_media_uploads_delete
BEFORE DELETE ON media_uploads
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.uploader_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_community_members_insert
BEFORE INSERT ON community_members
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_community_members_update
BEFORE UPDATE ON community_members
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_community_members_delete
BEFORE DELETE ON community_members
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_community_join_requests_insert
BEFORE INSERT ON community_join_requests
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_community_join_requests_update
BEFORE UPDATE ON community_join_requests
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_community_join_requests_delete
BEFORE DELETE ON community_join_requests
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_community_invites_insert
BEFORE INSERT ON community_invites
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.invited_by_ap_id, NEW.invited_ap_id, NEW.used_by_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_community_invites_update
BEFORE UPDATE ON community_invites
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.invited_by_ap_id, OLD.invited_ap_id, OLD.used_by_ap_id)
    OR target.actor_ap_id IN (NEW.invited_by_ap_id, NEW.invited_ap_id, NEW.used_by_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_community_invites_delete
BEFORE DELETE ON community_invites
WHEN EXISTS (
  SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.invited_by_ap_id, OLD.invited_ap_id, OLD.used_by_ap_id)
) AND NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id IN (
      SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.invited_by_ap_id, OLD.invited_ap_id, OLD.used_by_ap_id)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_community_bans_insert
BEFORE INSERT ON community_bans
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.banned_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_community_bans_update
BEFORE UPDATE ON community_bans
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.banned_ap_id)
    OR target.actor_ap_id IN (NEW.banned_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_community_bans_delete
BEFORE DELETE ON community_bans
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.banned_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_story_views_insert
BEFORE INSERT ON story_views
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE ((target.actor_ap_id IN (NEW.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = NEW.story_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = NEW.story_ap_id
        AND reserved.operation_id = target.operation_id
    )))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_story_views_update
BEFORE UPDATE ON story_views
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE ((target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = OLD.story_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.story_ap_id
        AND reserved.operation_id = target.operation_id
    ))
    OR (target.actor_ap_id IN (NEW.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = NEW.story_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = NEW.story_ap_id
        AND reserved.operation_id = target.operation_id
    )))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_story_views_delete
BEFORE DELETE ON story_views
WHEN EXISTS (
  SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id)
      UNION
      SELECT reserved.operation_id FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.story_ap_id
) AND NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id IN (
      SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id)
      UNION
      SELECT reserved.operation_id FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.story_ap_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_story_votes_insert
BEFORE INSERT ON story_votes
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE ((target.actor_ap_id IN (NEW.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = NEW.story_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = NEW.story_ap_id
        AND reserved.operation_id = target.operation_id
    )))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_story_votes_update
BEFORE UPDATE ON story_votes
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE ((target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = OLD.story_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.story_ap_id
        AND reserved.operation_id = target.operation_id
    ))
    OR (target.actor_ap_id IN (NEW.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = NEW.story_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = NEW.story_ap_id
        AND reserved.operation_id = target.operation_id
    )))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_story_votes_delete
BEFORE DELETE ON story_votes
WHEN EXISTS (
  SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id)
      UNION
      SELECT reserved.operation_id FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.story_ap_id
) AND NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id IN (
      SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id)
      UNION
      SELECT reserved.operation_id FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.story_ap_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_story_shares_insert
BEFORE INSERT ON story_shares
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE ((target.actor_ap_id IN (NEW.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = NEW.story_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = NEW.story_ap_id
        AND reserved.operation_id = target.operation_id
    )))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_story_shares_update
BEFORE UPDATE ON story_shares
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE ((target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = OLD.story_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.story_ap_id
        AND reserved.operation_id = target.operation_id
    ))
    OR (target.actor_ap_id IN (NEW.actor_ap_id)
    OR target.actor_ap_id = (
      SELECT owner.attributed_to FROM objects AS owner
      WHERE owner.ap_id = NEW.story_ap_id
    ) OR EXISTS (
      SELECT 1 FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = NEW.story_ap_id
        AND reserved.operation_id = target.operation_id
    )))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_story_shares_delete
BEFORE DELETE ON story_shares
WHEN EXISTS (
  SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id)
      UNION
      SELECT reserved.operation_id FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.story_ap_id
) AND NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id IN (
      SELECT target.operation_id FROM account_deletion_targets AS target
      WHERE target.actor_ap_id IN (OLD.actor_ap_id)
      UNION
      SELECT reserved.operation_id FROM account_deletion_object_targets AS reserved
      WHERE reserved.object_ap_id = OLD.story_ap_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_actor_notes_insert
BEFORE INSERT ON actor_notes
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_actor_notes_update
BEFORE UPDATE ON actor_notes
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_actor_notes_delete
BEFORE DELETE ON actor_notes
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_mobile_push_registrations_insert
BEFORE INSERT ON mobile_push_registrations
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_mobile_push_registrations_update
BEFORE UPDATE ON mobile_push_registrations
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_mobile_push_registrations_delete
BEFORE DELETE ON mobile_push_registrations
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_notification_pushers_insert
BEFORE INSERT ON notification_pushers
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_notification_pushers_update
BEFORE UPDATE ON notification_pushers
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.actor_ap_id)
    OR target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_call_sessions_insert
BEFORE INSERT ON call_sessions
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.local_actor_ap_id, NEW.peer_actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_call_sessions_update
BEFORE UPDATE ON call_sessions
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (OLD.local_actor_ap_id, OLD.peer_actor_ap_id)
    OR target.actor_ap_id IN (NEW.local_actor_ap_id, NEW.peer_actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_call_sessions_delete
BEFORE DELETE ON call_sessions
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE target.actor_ap_id IN (OLD.local_actor_ap_id, OLD.peer_actor_ap_id)
) AND NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id IN (
    SELECT target.operation_id FROM account_deletion_targets AS target
    WHERE target.actor_ap_id IN (OLD.local_actor_ap_id, OLD.peer_actor_ap_id)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

-- Push delivery workers may still update or reap existing jobs. Only new

-- target-owned push jobs are prohibited; the deletion cascade removes old ones.

CREATE TRIGGER IF NOT EXISTS account_deletion_notification_push_jobs_insert
BEFORE INSERT ON notification_push_jobs
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE (target.actor_ap_id IN (NEW.actor_ap_id))
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

-- A newly minted child must still have a live parent. This is checked at the
-- write, not at the earlier /accounts read, so a stale creator cannot add a
-- persona after the parent was reserved or tombstoned.
CREATE TRIGGER IF NOT EXISTS account_deletion_actors_insert
BEFORE INSERT ON actors
WHEN (
  NEW.owner_actor_ap_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM actors AS parent
    WHERE parent.ap_id = NEW.owner_actor_ap_id AND parent.deleted_at IS NULL
  )
) OR EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE target.actor_ap_id IN (NEW.ap_id, NEW.owner_actor_ap_id)
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

-- Counter reconciliation performed by an inbound event may still update the
-- reserved actor's three denormalized counters. Its identity, signing key,
-- owner association and tombstone can change only in the deletion batch.
CREATE TRIGGER IF NOT EXISTS account_deletion_actors_update
BEFORE UPDATE ON actors
WHEN (
  NEW.owner_actor_ap_id IS NOT OLD.owner_actor_ap_id
  AND NEW.owner_actor_ap_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM actors AS parent
    WHERE parent.ap_id = NEW.owner_actor_ap_id AND parent.deleted_at IS NULL
  )
) OR (
  (
    NEW.ap_id IS NOT OLD.ap_id
    OR NEW.type IS NOT OLD.type
    OR NEW.preferred_username IS NOT OLD.preferred_username
    OR NEW.name IS NOT OLD.name
    OR NEW.summary IS NOT OLD.summary
    OR NEW.icon_url IS NOT OLD.icon_url
    OR NEW.header_url IS NOT OLD.header_url
    OR NEW.inbox IS NOT OLD.inbox
    OR NEW.outbox IS NOT OLD.outbox
    OR NEW.followers_url IS NOT OLD.followers_url
    OR NEW.following_url IS NOT OLD.following_url
    OR NEW.public_key_pem IS NOT OLD.public_key_pem
    OR NEW.private_key_pem IS NOT OLD.private_key_pem
    OR NEW.takos_user_id IS NOT OLD.takos_user_id
    OR NEW.is_private IS NOT OLD.is_private
    OR NEW.role IS NOT OLD.role
    OR NEW.fields_json IS NOT OLD.fields_json
    OR NEW.also_known_as_json IS NOT OLD.also_known_as_json
    OR NEW.moved_to IS NOT OLD.moved_to
    OR NEW.deleted_at IS NOT OLD.deleted_at
    OR NEW.owner_actor_ap_id IS NOT OLD.owner_actor_ap_id
  )
  AND EXISTS (
    SELECT 1 FROM account_deletion_targets AS target
    WHERE target.actor_ap_id IN (
      OLD.ap_id, NEW.ap_id, OLD.owner_actor_ap_id, NEW.owner_actor_ap_id
    )
      AND NOT EXISTS (
        SELECT 1 FROM actor_write_assertions AS marker
        WHERE marker.operation_id = target.operation_id
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_actors_delete
BEFORE DELETE ON actors
WHEN EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE target.actor_ap_id IN (OLD.ap_id, OLD.owner_actor_ap_id)
    AND NOT EXISTS (
      SELECT 1 FROM actor_write_assertions AS marker
      WHERE marker.operation_id = target.operation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

-- Keep recovery authority until every target is complete and the final batch
-- has tombstoned all actors and removed their sessions. These release checks
-- run while the target snapshot is still present.
CREATE TRIGGER IF NOT EXISTS account_deletion_object_targets_delete
BEFORE DELETE ON account_deletion_object_targets
WHEN NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id = OLD.operation_id
) OR EXISTS (
  SELECT 1 FROM media_upload_attempts AS attempt
  JOIN account_deletion_targets AS target
    ON target.actor_ap_id = attempt.uploader_ap_id
  WHERE target.operation_id = OLD.operation_id
) OR EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  LEFT JOIN actors AS current_actor ON current_actor.ap_id = target.actor_ap_id
  WHERE target.operation_id = OLD.operation_id
    AND (
      target.cascade_complete <> 1
      OR current_actor.ap_id IS NULL
      OR current_actor.deleted_at IS NULL
      OR EXISTS (
        SELECT 1 FROM sessions AS session
        WHERE session.member_id = target.actor_ap_id
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletion_targets_delete
BEFORE DELETE ON account_deletion_targets
WHEN NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id = OLD.operation_id
) OR EXISTS (
  SELECT 1 FROM media_upload_attempts AS attempt
  JOIN account_deletion_targets AS target
    ON target.actor_ap_id = attempt.uploader_ap_id
  WHERE target.operation_id = OLD.operation_id
) OR EXISTS (
  SELECT 1 FROM account_deletion_object_targets AS reserved
  WHERE reserved.operation_id = OLD.operation_id
) OR EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  LEFT JOIN actors AS current_actor ON current_actor.ap_id = target.actor_ap_id
  WHERE target.operation_id = OLD.operation_id
    AND (
      target.cascade_complete <> 1
      OR current_actor.ap_id IS NULL
      OR current_actor.deleted_at IS NULL
      OR EXISTS (
        SELECT 1 FROM sessions AS session
        WHERE session.member_id = target.actor_ap_id
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;

CREATE TRIGGER IF NOT EXISTS account_deletions_delete
BEFORE DELETE ON account_deletions
WHEN NOT EXISTS (
  SELECT 1 FROM actor_write_assertions AS marker
  WHERE marker.operation_id = OLD.id
) OR EXISTS (
  SELECT 1 FROM media_upload_attempts AS attempt
  WHERE attempt.uploader_ap_id = OLD.root_actor_ap_id
    OR attempt.uploader_ap_id IN (
      SELECT target.actor_ap_id FROM account_deletion_targets AS target
      WHERE target.operation_id = OLD.id
    )
) OR EXISTS (
  SELECT 1 FROM account_deletion_object_targets AS reserved
  WHERE reserved.operation_id = OLD.id
) OR EXISTS (
  SELECT 1 FROM account_deletion_targets AS target
  WHERE target.operation_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'account deletion reserved');
END;
