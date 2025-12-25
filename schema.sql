-- 1. Create the polls table
CREATE TABLE IF NOT EXISTS polls (
    message_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Enable Row Level Security (RLS) if you want to restrict access, 
-- but for a bot with a service key, it might not be strictly necessary unless using public client.
-- ALTER TABLE polls ENABLE ROW LEVEL SECURITY;

-- 2. Create the votes table
-- Designed to support single vote per user per poll initially
-- But flexible enough to change PK or logic later for multi-select (which might use multiple rows or an array)

CREATE TABLE IF NOT EXISTS votes (
    poll_id TEXT NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    option_index INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (poll_id, user_id, option_index)
);

-- Index for faster count aggregation
CREATE INDEX IF NOT EXISTS idx_votes_poll_id ON votes(poll_id);

-- 3. Create guild_settings table
CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    allow_poll_buttons BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS Policies for guild_settings
ALTER TABLE guild_settings ENABLE ROW LEVEL SECURITY;

-- Drop existin policies if they exist to avoid errors on re-run (or use DO block, but simple CREATE POLICY IF NOT EXISTS isn't standard in older PG, 
-- duplicate policy names error out. We'll leave as CREATE POLICY which might fail if re-run, but for "one massive file" for fresh DB it's fine.
-- To be safe for re-runs, we can wrap in DO blocks or just assume fresh DB as user implied.)

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT FROM pg_catalog.pg_policies 
        WHERE tablename = 'guild_settings' AND policyname = 'Enable read access for all users'
    ) THEN
        CREATE POLICY "Enable read access for all users" ON guild_settings
            FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT FROM pg_catalog.pg_policies 
        WHERE tablename = 'guild_settings' AND policyname = 'Enable insert/update for service role only'
    ) THEN
        CREATE POLICY "Enable insert/update for service role only" ON guild_settings
            FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;
