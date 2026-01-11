-- Add discord_deleted column to polls table
-- This tracks when a Discord message has been deleted but the poll remains in DB
ALTER TABLE polls ADD COLUMN IF NOT EXISTS discord_deleted BOOLEAN DEFAULT FALSE;
