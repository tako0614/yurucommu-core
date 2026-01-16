-- Add expires_at column to community_invites for invite expiration support
ALTER TABLE community_invites ADD COLUMN expires_at TEXT;

-- Update join validation to check expiration
-- Note: Expiration check is done in application code, not in DB constraints
