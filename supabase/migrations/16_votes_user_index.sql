-- Migration: Add user_id index on votes table
-- Created: 2026-01-15
-- Purpose: Supports future "view all my votes" feature

-- Index for efficient lookup of all votes by a specific user
CREATE INDEX IF NOT EXISTS idx_votes_user_id ON votes(user_id);

COMMENT ON INDEX idx_votes_user_id IS 'Supports efficient lookup of all votes cast by a user across all polls.';
