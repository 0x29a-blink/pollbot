-- Migration: Add poll scheduling columns
-- Created: 2026-01-11

-- Add ends_at column for poll expiration/scheduling
ALTER TABLE polls ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

-- Add scheduled_start column for future poll scheduling
ALTER TABLE polls ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ;

-- Create index for efficient querying of polls that need to be auto-closed
CREATE INDEX IF NOT EXISTS idx_polls_ends_at ON polls(ends_at) 
WHERE ends_at IS NOT NULL AND active = true;

-- Create index for scheduled polls that need to be started
CREATE INDEX IF NOT EXISTS idx_polls_scheduled_start ON polls(scheduled_start) 
WHERE scheduled_start IS NOT NULL AND active = false;

COMMENT ON COLUMN polls.ends_at IS 'When the poll should automatically close. NULL means no auto-close.';
COMMENT ON COLUMN polls.scheduled_start IS 'When the poll should automatically start. NULL means start immediately.';
