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
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    left_at TIMESTAMPTZ
);

COMMENT ON COLUMN guilds.left_at IS 'Set when the bot leaves the guild; NULL while the bot is a member. Cleared on re-join.';

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

-- 7. usage_events table (bot vs dashboard usage telemetry)
CREATE TABLE IF NOT EXISTS usage_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('bot', 'dashboard')),
    event_type TEXT NOT NULL,
    guild_id TEXT,
    user_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. dashboard_sessions table
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

-- Guilds the bot has left (partial: most rows have left_at NULL)
CREATE INDEX IF NOT EXISTS idx_guilds_left_at ON guilds(left_at) WHERE left_at IS NOT NULL;

-- Usage telemetry queries (aggregated by day)
CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at DESC);

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
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

-- Service role policies (bot uses service key which bypasses RLS, but explicit is best practice)
CREATE POLICY "Service role full access" ON polls FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON votes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON global_stats FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON dashboard_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
-- usage_events: service_role only; deliberately NO public read (rows contain user_ids)
CREATE POLICY "Service role full access" ON usage_events FOR ALL TO service_role USING (true) WITH CHECK (true);

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

-- Get total member count across current guilds (excludes guilds the bot left)
CREATE OR REPLACE FUNCTION get_total_members()
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT COALESCE(SUM(member_count), 0)::BIGINT FROM guilds WHERE left_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION get_total_members() TO public;

-- Atomic peak update: GREATEST server-side, no read-modify-write race.
CREATE OR REPLACE FUNCTION bump_peak_active_servers(p_current INT)
RETURNS INT
LANGUAGE SQL
AS $$
    UPDATE global_stats
    SET peak_active_servers = GREATEST(peak_active_servers, p_current),
        last_updated = NOW()
    WHERE id = 1
    RETURNING peak_active_servers;
$$;

REVOKE ALL ON FUNCTION bump_peak_active_servers(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bump_peak_active_servers(INT) TO service_role;

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

-- Bot vs dashboard usage per day (aggregates only, no user_ids exposed)
CREATE OR REPLACE FUNCTION get_usage_summary(p_days INT DEFAULT 30)
RETURNS TABLE(day DATE, source TEXT, events BIGINT, unique_users BIGINT)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT created_at::DATE AS day, usage_events.source, COUNT(*)::BIGINT, COUNT(DISTINCT user_id)::BIGINT
    FROM usage_events
    WHERE created_at > NOW() - make_interval(days => LEAST(GREATEST(p_days, 1), 365))
    GROUP BY 1, 2
    ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION get_usage_summary(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_usage_summary(INT) TO anon, authenticated, service_role;

-- Premium Vote Analytics (service_role ONLY — reached via the authenticated API)

CREATE OR REPLACE FUNCTION get_guild_vote_activity(p_guild_id TEXT, p_days INT DEFAULT 30)
RETURNS TABLE(day DATE, votes BIGINT, unique_voters BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
    SELECT v.created_at::DATE, COUNT(*)::BIGINT, COUNT(DISTINCT v.user_id)::BIGINT
    FROM votes v JOIN polls p ON v.poll_id = p.message_id
    WHERE p.guild_id = p_guild_id
      AND v.created_at > NOW() - make_interval(days => LEAST(GREATEST(p_days, 1), 365))
    GROUP BY 1 ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION get_guild_vote_activity(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_guild_vote_activity(TEXT, INT) TO service_role;

CREATE OR REPLACE FUNCTION get_guild_peak_hours(p_guild_id TEXT, p_days INT DEFAULT 30)
RETURNS TABLE(hour INT, votes BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
    SELECT EXTRACT(HOUR FROM v.created_at)::INT, COUNT(*)::BIGINT
    FROM votes v JOIN polls p ON v.poll_id = p.message_id
    WHERE p.guild_id = p_guild_id
      AND v.created_at > NOW() - make_interval(days => LEAST(GREATEST(p_days, 1), 365))
    GROUP BY 1 ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION get_guild_peak_hours(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_guild_peak_hours(TEXT, INT) TO service_role;

CREATE OR REPLACE FUNCTION get_guild_top_voters(p_guild_id TEXT, p_days INT DEFAULT 30, p_limit INT DEFAULT 10)
RETURNS TABLE(user_id TEXT, votes BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
    SELECT v.user_id, COUNT(*)::BIGINT
    FROM votes v JOIN polls p ON v.poll_id = p.message_id
    WHERE p.guild_id = p_guild_id
      AND v.created_at > NOW() - make_interval(days => LEAST(GREATEST(p_days, 1), 365))
    GROUP BY 1 ORDER BY 2 DESC LIMIT LEAST(GREATEST(p_limit, 1), 25);
$$;

REVOKE ALL ON FUNCTION get_guild_top_voters(TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_guild_top_voters(TEXT, INT, INT) TO service_role;

-- Admin dashboard analytics (aggregates only — anon may execute)

CREATE OR REPLACE FUNCTION get_vote_history(p_days INT DEFAULT 7)
RETURNS TABLE(day DATE, votes BIGINT, unique_voters BIGINT, polls_created BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
    WITH bounds AS (
        SELECT LEAST(GREATEST(p_days, 1), 365) AS n
    ),
    days AS (
        SELECT generate_series(
            CURRENT_DATE - ((SELECT n FROM bounds) - 1),
            CURRENT_DATE,
            '1 day'
        )::date AS day
    ),
    v AS (
        SELECT vt.created_at::date AS day,
               COUNT(*)::BIGINT AS votes,
               COUNT(DISTINCT vt.user_id)::BIGINT AS unique_voters
        FROM votes vt
        WHERE vt.created_at >= CURRENT_DATE - ((SELECT n FROM bounds) - 1)
        GROUP BY 1
    ),
    pl AS (
        SELECT po.created_at::date AS day, COUNT(*)::BIGINT AS polls_created
        FROM polls po
        WHERE po.created_at >= CURRENT_DATE - ((SELECT n FROM bounds) - 1)
        GROUP BY 1
    )
    SELECT d.day, COALESCE(v.votes, 0), COALESCE(v.unique_voters, 0), COALESCE(pl.polls_created, 0)
    FROM days d
    LEFT JOIN v USING (day)
    LEFT JOIN pl USING (day)
    ORDER BY d.day;
$$;

REVOKE ALL ON FUNCTION get_vote_history(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_vote_history(INT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION get_global_peak_hours(p_days INT DEFAULT 30)
RETURNS TABLE(hour INT, votes BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
    WITH hours AS (
        SELECT generate_series(0, 23) AS hour
    ),
    v AS (
        SELECT EXTRACT(HOUR FROM vt.created_at)::INT AS hour, COUNT(*)::BIGINT AS votes
        FROM votes vt
        WHERE vt.created_at > NOW() - make_interval(days => LEAST(GREATEST(p_days, 1), 365))
        GROUP BY 1
    )
    SELECT h.hour, COALESCE(v.votes, 0)
    FROM hours h LEFT JOIN v USING (hour)
    ORDER BY h.hour;
$$;

REVOKE ALL ON FUNCTION get_global_peak_hours(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_global_peak_hours(INT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION get_top_guilds(p_days INT DEFAULT 30, p_limit INT DEFAULT 5)
RETURNS TABLE(guild_id TEXT, guild_name TEXT, votes BIGINT, polls BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
    SELECT p.guild_id,
           COALESCE(g.name, 'Unknown Server'),
           COUNT(*)::BIGINT AS votes,
           COUNT(DISTINCT p.message_id)::BIGINT AS polls
    FROM votes v
    JOIN polls p ON v.poll_id = p.message_id
    LEFT JOIN guilds g ON g.id = p.guild_id
    WHERE v.created_at > NOW() - make_interval(days => LEAST(GREATEST(p_days, 1), 365))
      AND g.left_at IS NULL
    GROUP BY 1, 2
    ORDER BY 3 DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 25);
$$;

REVOKE ALL ON FUNCTION get_top_guilds(INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_top_guilds(INT, INT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION get_top_creators(p_limit INT DEFAULT 5)
RETURNS TABLE(creator_id TEXT, polls BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
    SELECT po.creator_id, COUNT(*)::BIGINT
    FROM polls po
    WHERE po.creator_id IS NOT NULL
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 25);
$$;

REVOKE ALL ON FUNCTION get_top_creators(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_top_creators(INT) TO anon, authenticated, service_role;

-- ============================================================================
-- REALTIME
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE polls;
ALTER PUBLICATION supabase_realtime ADD TABLE global_stats;
ALTER PUBLICATION supabase_realtime ADD TABLE votes;
