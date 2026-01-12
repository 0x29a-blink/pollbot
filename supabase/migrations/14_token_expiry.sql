-- Migration: Add Discord access token expiry tracking
-- Created: 2026-01-11

-- Add column to track when the Discord access token expires
-- This enables proactive token refresh before expiry
ALTER TABLE dashboard_sessions 
ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN dashboard_sessions.access_token_expires_at IS 
    'When the Discord access token expires. Used for proactive refresh.';
