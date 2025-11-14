-- Remove legacy access_tokens table after switching to per-user JWT secrets
PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS access_tokens_token_hash_key;
DROP INDEX IF EXISTS access_tokens_user_id_idx;
DROP TABLE IF EXISTS access_tokens;

PRAGMA foreign_keys = ON;

