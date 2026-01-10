-- 01_initial_schema.sql
-- Creates all tables with complete column definitions

-- 1. guilds table (must come before polls for FK)
CREATE TABLE IF NOT EXISTS guilds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    member_count INTEGER DEFAULT 0,
    icon_url TEXT,
    locale TEXT DEFAULT 'en-US'::text,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. polls table
CREATE TABLE IF NOT EXISTS polls (
    message_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    guild_id TEXT NOT NULL REFERENCES guilds(id),
    creator_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 3. votes table
CREATE TABLE IF NOT EXISTS votes (
    poll_id TEXT NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    option_index INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    weight INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (poll_id, user_id, option_index)
);

-- 4. guild_settings table
CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    allow_poll_buttons BOOLEAN DEFAULT TRUE,
    locale TEXT,
    vote_weights JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. global_stats table (singleton)
CREATE TABLE IF NOT EXISTS global_stats (
    id INT PRIMARY KEY DEFAULT 1,
    total_polls BIGINT DEFAULT 0,
    total_votes BIGINT DEFAULT 0,
    peak_active_servers INT DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT global_stats_id_check CHECK (id = 1)
);

-- Initialize global_stats
INSERT INTO global_stats (id, total_polls, total_votes)
VALUES (1, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- 6. users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    last_vote_at TIMESTAMPTZ
);
