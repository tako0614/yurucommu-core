-- Add missing columns used by activity/inbox flows

ALTER TABLE activities ADD COLUMN published TEXT;
ALTER TABLE activities ADD COLUMN local INTEGER DEFAULT 0;
ALTER TABLE activities ADD COLUMN to_json TEXT DEFAULT '[]';
