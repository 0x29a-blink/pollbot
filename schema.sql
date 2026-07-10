-- PollBot Database Schema
-- Source of truth for database structure
-- Last Updated: 2026-01-15

-- ============================================================================
-- TABLES
-- ============================================================================

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
    active BOOLEAN NOT NULL DEFAULT TRUE,
    discord_deleted BOOLEAN DEFAULT FALSE,
    -- Poll scheduling (future feature)
    ends_at TIMESTAMPTZ,
    scheduled_start TIMESTAMPTZ
);

COMMENT ON COLUMN polls.ends_at IS 'When the poll should automatically close. NULL means no auto-close.';
COMMENT ON COLUMN polls.scheduled_start IS 'When the poll should automatically start. NULL means start immediately.';

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
    last_vote_at TIMESTAMPTZ,
    username TEXT,
    discriminator TEXT,
    avatar_url TEXT,
    is_admin BOOLEAN DEFAULT FALSE
);

-- 7. dashboard_sessions table
CREATE TABLE IF NOT EXISTS dashboard_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Guild caching to prevent Discord API rate limits
    cached_guilds JSONB,
    guilds_cached_at TIMESTAMPTZ,
    -- Discord token expiry tracking for proactive refresh
    access_token_expires_at TIMESTAMPTZ
);

COMMENT ON COLUMN dashboard_sessions.access_token_expires_at IS 
    'When the Discord access token expires. Used for proactive refresh.';

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Vote queries
CREATE INDEX IF NOT EXISTS idx_votes_poll_id ON votes(poll_id);
CREATE INDEX IF NOT EXISTS idx_votes_user_id ON votes(user_id);

-- Session management
CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_user_id ON dashboard_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_expires_at ON dashboard_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_guilds_cached_at ON dashboard_sessions(guilds_cached_at);

-- Poll queries
CREATE INDEX IF NOT EXISTS idx_polls_guild_id ON polls(guild_id);
CREATE INDEX IF NOT EXISTS idx_polls_creator_id ON polls(creator_id);
CREATE INDEX IF NOT EXISTS idx_polls_created_at ON polls(created_at DESC);

-- Poll scheduling (partial indexes for efficiency)
CREATE INDEX IF NOT EXISTS idx_polls_ends_at ON polls(ends_at) 
WHERE ends_at IS NOT NULL AND active = true;

CREATE INDEX IF NOT EXISTS idx_polls_scheduled_start ON polls(scheduled_start) 
WHERE scheduled_start IS NOT NULL AND active = false;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE guilds ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_sessions ENABLE ROW LEVEL SECURITY;

-- Service role policies (bot uses service key which bypasses RLS, but explicit is best practice)
CREATE POLICY "Service role full access" ON polls FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON votes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON global_stats FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON dashboard_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Public read access for telemetry panel (uses anon key)
CREATE POLICY "Public read access" ON polls FOR SELECT USING (true);
CREATE POLICY "Public read access" ON votes FOR SELECT USING (true);
CREATE POLICY "Public read access" ON global_stats FOR SELECT USING (true);
CREATE POLICY "Public read access" ON users FOR SELECT USING (true);

-- guild_settings: public read, service_role write
CREATE POLICY "Public read access" ON guild_settings FOR SELECT USING (true);
CREATE POLICY "Service role write access" ON guild_settings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- guilds: public read, service_role write  
CREATE POLICY "Public read access" ON guilds FOR SELECT USING (true);
CREATE POLICY "Service role write access" ON guilds FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- TRIGGERS (with fixed search_path for security)
-- ============================================================================

CREATE OR REPLACE FUNCTION update_global_poll_count()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE global_stats
    SET total_polls = total_polls + 1,
        last_updated = NOW()
    WHERE id = 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_global_poll_count ON polls;
CREATE TRIGGER trg_update_global_poll_count
AFTER INSERT ON polls
FOR EACH ROW
EXECUTE FUNCTION update_global_poll_count();

CREATE OR REPLACE FUNCTION update_global_vote_count()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE global_stats
    SET total_votes = total_votes + 1,
        last_updated = NOW()
    WHERE id = 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_global_vote_count ON votes;
CREATE TRIGGER trg_update_global_vote_count
AFTER INSERT ON votes
FOR EACH ROW
EXECUTE FUNCTION update_global_vote_count();

-- ============================================================================
-- RPC FUNCTIONS
-- ============================================================================

-- Get total member count across all guilds (avoids query limits)
CREATE OR REPLACE FUNCTION get_total_members()
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT COALESCE(SUM(member_count), 0)::BIGINT FROM guilds;
$$;

GRANT EXECUTE ON FUNCTION get_total_members() TO public;

-- Atomically replace a user's votes on a poll (delete old + insert new in one
-- transaction) so a failed insert can never erase the user's prior vote.
CREATE OR REPLACE FUNCTION replace_vote(
    p_poll_id TEXT,
    p_user_id TEXT,
    p_options INTEGER[],
    p_weight INTEGER
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM votes WHERE poll_id = p_poll_id AND user_id = p_user_id;

    INSERT INTO votes (poll_id, user_id, option_index, weight)
    SELECT p_poll_id, p_user_id, opt, p_weight
    FROM unnest(p_options) AS opt;
END;
$$;

-- Only the bot (service_role) may replace votes; deny the default PUBLIC grant.
REVOKE ALL ON FUNCTION replace_vote(TEXT, TEXT, INTEGER[], INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION replace_vote(TEXT, TEXT, INTEGER[], INTEGER) TO service_role;

-- Aggregate stats for the public dashboard (return only counts, never per-user
-- rows) so the anon key does not need blanket read on `users`/`votes`.
CREATE OR REPLACE FUNCTION get_active_voter_count()
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT COUNT(*)::BIGINT
    FROM users
    WHERE last_vote_at IS NOT NULL
      AND last_vote_at > NOW() - INTERVAL '13 hours';
$$;

REVOKE ALL ON FUNCTION get_active_voter_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_active_voter_count() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION get_guild_vote_counts()
RETURNS TABLE(guild_id TEXT, vote_count BIGINT)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT p.guild_id, COUNT(v.*)::BIGINT AS vote_count
    FROM votes v
    JOIN polls p ON v.poll_id = p.message_id
    GROUP BY p.guild_id;
$$;

REVOKE ALL ON FUNCTION get_guild_vote_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_guild_vote_counts() TO anon, authenticated, service_role;

-- ============================================================================
-- REALTIME
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE polls;
ALTER PUBLICATION supabase_realtime ADD TABLE global_stats;
ALTER PUBLICATION supabase_realtime ADD TABLE votes;
