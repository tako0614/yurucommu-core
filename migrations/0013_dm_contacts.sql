-- DM Contacts List
-- Tracks who should appear in a user's DM contact list
-- Added when: user follows someone, or receives a message from someone

CREATE TABLE IF NOT EXISTS dm_contacts (
  owner_ap_id TEXT NOT NULL,        -- The user who owns this contact list
  contact_ap_id TEXT NOT NULL,      -- The contact to show in the list
  added_reason TEXT NOT NULL CHECK (added_reason IN ('follow', 'message_received')),
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (owner_ap_id, contact_ap_id)
);

-- Index for efficient lookup
CREATE INDEX IF NOT EXISTS idx_dm_contacts_owner ON dm_contacts(owner_ap_id, created_at DESC);
