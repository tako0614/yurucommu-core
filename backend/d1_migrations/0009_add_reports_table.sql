-- Create reports table for moderation
CREATE TABLE reports (
    id TEXT PRIMARY KEY,
    reporter_actor_id TEXT NOT NULL,
    target_actor_id TEXT NOT NULL,
    target_object_id TEXT,
    reason TEXT,
    status TEXT DEFAULT 'pending', -- pending, resolved, rejected
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_target_actor_id ON reports(target_actor_id);
