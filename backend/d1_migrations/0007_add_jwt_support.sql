-- Migration: Add JWT support and remove session-based auth

-- Add jwt_secret column to users table
ALTER TABLE users ADD COLUMN jwt_secret TEXT;

-- Drop sessions table (no longer needed with JWT)
DROP TABLE IF EXISTS sessions;
