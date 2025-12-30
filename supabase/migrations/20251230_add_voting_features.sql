-- Add weight column to votes table
ALTER TABLE votes ADD COLUMN IF NOT EXISTS weight INTEGER NOT NULL DEFAULT 1;

-- Add vote_weights to guild_settings
ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS vote_weights JSONB NOT NULL DEFAULT '{}'::jsonb;
