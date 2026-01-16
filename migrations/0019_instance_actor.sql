-- Instance Group Actor for ActivityPub endpoints

CREATE TABLE IF NOT EXISTS instance_actor (
  ap_id TEXT PRIMARY KEY,
  preferred_username TEXT NOT NULL,
  name TEXT,
  summary TEXT,
  public_key_pem TEXT NOT NULL,
  private_key_pem TEXT NOT NULL,
  join_policy TEXT DEFAULT 'open' CHECK (join_policy IN ('open', 'approval', 'invite')),
  posting_policy TEXT DEFAULT 'members' CHECK (posting_policy IN ('anyone', 'members', 'mods', 'owners')),
  visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
