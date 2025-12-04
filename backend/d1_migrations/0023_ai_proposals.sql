-- AI Proposal Queue (PLAN.md 6.4.3)
-- 手動承認フローのための提案テーブル

CREATE TABLE IF NOT EXISTS ai_proposals (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- config_change, code_patch, action_enable, action_disable
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected, expired
  content_json TEXT NOT NULL, -- ProposalContent serialized
  metadata_json TEXT NOT NULL, -- ProposalMetadata serialized
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_comment TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_proposals_status ON ai_proposals(status);
CREATE INDEX IF NOT EXISTS idx_ai_proposals_type ON ai_proposals(type);
CREATE INDEX IF NOT EXISTS idx_ai_proposals_created_at ON ai_proposals(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_proposals_expires_at ON ai_proposals(expires_at);
