-- Sync Prod Schema with Local Development
-- 1. Add missing 'weight' column to votes (from voting features)
ALTER TABLE votes ADD COLUMN IF NOT EXISTS weight INTEGER NOT NULL DEFAULT 1;

-- 2. Add missing 'vote_weights' column to guild_settings (from voting features)
ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS vote_weights JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3. Ensure 'votes' foreign key has ON DELETE CASCADE (missing in prod)
ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_poll_id_fkey;
ALTER TABLE votes ADD CONSTRAINT votes_poll_id_fkey 
    FOREIGN KEY (poll_id) REFERENCES polls(message_id) 
    ON DELETE CASCADE;

-- 4. Ensure indices exist (good practice)
CREATE INDEX IF NOT EXISTS idx_votes_poll_id ON votes(poll_id);
