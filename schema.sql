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

-- 9. botlist_votes table (vote events from bot listing sites)
-- One row per vote received from Top.gg or DiscordForge, including the extra
-- voter metadata each site sends. users.last_vote_at remains the source of
-- truth for the premium window; the webhook updates both.
CREATE TABLE IF NOT EXISTS botlist_votes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('topgg', 'discordforge')),
    user_id TEXT NOT NULL,
    username TEXT,
    avatar_url TEXT,
    -- Vote weight (Top.gg sends 2 during weekend double-vote promos)
    weight INTEGER NOT NULL DEFAULT 1,
    is_test BOOLEAN NOT NULL DEFAULT FALSE,
    is_weekend BOOLEAN,
    -- DiscordForge includes the voter's running counts in its webhook
    weekly_votes INTEGER,
    total_votes INTEGER,
    -- Top.gg passes through query params from the vote URL (campaign tracking)
    query JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

-- Bot-list vote analytics
CREATE INDEX IF NOT EXISTS idx_botlist_votes_created_at ON botlist_votes(created_at);
CREATE INDEX IF NOT EXISTS idx_botlist_votes_user_id ON botlist_votes(user_id, created_at);

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
ALTER TABLE botlist_votes ENABLE ROW LEVEL SECURITY;

-- Service role policies (bot uses service key which bypasses RLS, but explicit is best practice)
CREATE POLICY "Service role full access" ON polls FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON votes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON global_stats FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON dashboard_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
-- usage_events: service_role only; deliberately NO public read (rows contain user_ids)
CREATE POLICY "Service role full access" ON usage_events FOR ALL TO service_role USING (true) WITH CHECK (true);
-- botlist_votes: service_role only; deliberately NO public read (rows contain user_ids)
CREATE POLICY "Service role full access" ON botlist_votes FOR ALL TO service_role USING (true) WITH CHECK (true);

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
REVOKE ALL ON FUNCTION replace_vote(TEXT, TEXT, INTEGER[], INTEGER) FROM PUBLIC, anon, authenticated;
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

REVOKE ALL ON FUNCTION get_guild_vote_activity(TEXT, INT) FROM PUBLIC, anon, authenticated;
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

REVOKE ALL ON FUNCTION get_guild_peak_hours(TEXT, INT) FROM PUBLIC, anon, authenticated;
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

REVOKE ALL ON FUNCTION get_guild_top_voters(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
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

-- Batch vote counts for poll list views as a single JSONB value
-- ({ poll_id: { option_index: count } }) — immune to PostgREST's 1000-row cap.
CREATE OR REPLACE FUNCTION get_poll_vote_counts(p_poll_ids TEXT[])
RETURNS JSONB
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
    SELECT COALESCE(jsonb_object_agg(per_poll.poll_id, per_poll.counts), '{}'::jsonb)
    FROM (
        SELECT c.poll_id, jsonb_object_agg(c.option_index::text, c.cnt) AS counts
        FROM (
            SELECT v.poll_id, v.option_index, COUNT(*)::INT AS cnt
            FROM votes v
            WHERE v.poll_id = ANY(p_poll_ids[1:200])
            GROUP BY 1, 2
        ) c
        GROUP BY c.poll_id
    ) per_poll;
$$;

REVOKE ALL ON FUNCTION get_poll_vote_counts(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_poll_vote_counts(TEXT[]) TO anon, authenticated, service_role;

-- ============================================================================
-- Bot-list vote analytics (Top.gg + DiscordForge)
-- ============================================================================

-- Votes and unique voters per day per source, zero-filled for every
-- (day, source) pair so stacked charts don't skip days. Aggregates only —
-- anon may execute, matching the get_vote_history pattern. Test votes excluded.
CREATE OR REPLACE FUNCTION get_botlist_vote_history(p_days INT DEFAULT 30)
RETURNS TABLE(day DATE, source TEXT, votes BIGINT, unique_voters BIGINT)
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
    sources AS (
        SELECT unnest(ARRAY['topgg', 'discordforge']) AS source
    ),
    v AS (
        SELECT bv.created_at::date AS day,
               bv.source,
               COUNT(*)::BIGINT AS votes,
               COUNT(DISTINCT bv.user_id)::BIGINT AS unique_voters
        FROM botlist_votes bv
        WHERE bv.created_at >= CURRENT_DATE - ((SELECT n FROM bounds) - 1)
          AND NOT bv.is_test
        GROUP BY 1, 2
    )
    SELECT d.day, s.source, COALESCE(v.votes, 0), COALESCE(v.unique_voters, 0)
    FROM days d
    CROSS JOIN sources s
    LEFT JOIN v ON v.day = d.day AND v.source = s.source
    ORDER BY d.day, s.source;
$$;

REVOKE ALL ON FUNCTION get_botlist_vote_history(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_botlist_vote_history(INT) TO anon, authenticated, service_role;

-- Headline totals per source (all-time and last 30 days). Aggregates only.
CREATE OR REPLACE FUNCTION get_botlist_vote_totals()
RETURNS TABLE(source TEXT, votes_total BIGINT, voters_total BIGINT, votes_30d BIGINT, voters_30d BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
    SELECT s.source,
           COALESCE(COUNT(bv.*) FILTER (WHERE TRUE), 0)::BIGINT,
           COALESCE(COUNT(DISTINCT bv.user_id), 0)::BIGINT,
           COALESCE(COUNT(bv.*) FILTER (WHERE bv.created_at > NOW() - INTERVAL '30 days'), 0)::BIGINT,
           COALESCE(COUNT(DISTINCT bv.user_id) FILTER (WHERE bv.created_at > NOW() - INTERVAL '30 days'), 0)::BIGINT
    FROM (SELECT unnest(ARRAY['topgg', 'discordforge']) AS source) s
    LEFT JOIN botlist_votes bv ON bv.source = s.source AND NOT bv.is_test
    GROUP BY s.source
    ORDER BY s.source;
$$;

REVOKE ALL ON FUNCTION get_botlist_vote_totals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_botlist_vote_totals() TO anon, authenticated, service_role;

-- Top bot-list voters with identity (user id, username) — per-user rows, so
-- service_role ONLY; the dashboard reaches this through the authenticated
-- admin API, never the anon key.
CREATE OR REPLACE FUNCTION get_top_botlist_voters(p_days INT DEFAULT 30, p_limit INT DEFAULT 10)
RETURNS TABLE(user_id TEXT, username TEXT, avatar_url TEXT, votes BIGINT, sources TEXT[], last_vote_at TIMESTAMPTZ)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
    SELECT bv.user_id,
           COALESCE(u.username, MAX(bv.username) FILTER (WHERE bv.username IS NOT NULL)),
           COALESCE(u.avatar_url, MAX(bv.avatar_url) FILTER (WHERE bv.avatar_url IS NOT NULL)),
           COUNT(*)::BIGINT AS votes,
           ARRAY_AGG(DISTINCT bv.source),
           MAX(bv.created_at)
    FROM botlist_votes bv
    LEFT JOIN users u ON u.id = bv.user_id
    WHERE bv.created_at > NOW() - make_interval(days => LEAST(GREATEST(p_days, 1), 365))
      AND NOT bv.is_test
    GROUP BY bv.user_id, u.username, u.avatar_url
    ORDER BY votes DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

REVOKE ALL ON FUNCTION get_top_botlist_voters(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_top_botlist_voters(INT, INT) TO service_role;

-- ============================================================================
-- REALTIME
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE polls;
ALTER PUBLICATION supabase_realtime ADD TABLE global_stats;
ALTER PUBLICATION supabase_realtime ADD TABLE votes;

-- ============================================================================
-- Bot-list voter analytics v2 (admin dashboard hub + poll supporter cards).
-- All service_role-only: per-user data, reached via the authenticated API.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. One-call analytics bundle: history, hourly/weekday patterns, new vs
--    returning voters, platform overlap, weekend share, campaign sources.
--    p_source filters to one list ('topgg'/'discordforge'); NULL = both.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_botlist_analytics(p_days INT DEFAULT 30, p_source TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
WITH bounds AS (
    SELECT LEAST(GREATEST(p_days, 1), 365) AS n
),
window_start AS (
    SELECT (CURRENT_DATE - ((SELECT n FROM bounds) - 1))::timestamptz AS ts
),
f AS (
    SELECT bv.*
    FROM botlist_votes bv
    WHERE NOT bv.is_test
      AND bv.created_at >= (SELECT ts FROM window_start)
      AND (p_source IS NULL OR bv.source = p_source)
),
days AS (
    SELECT generate_series(
        CURRENT_DATE - ((SELECT n FROM bounds) - 1),
        CURRENT_DATE,
        '1 day'
    )::date AS day
),
history AS (
    SELECT d.day, s.source, COALESCE(v.votes, 0) AS votes, COALESCE(v.unique_voters, 0) AS unique_voters
    FROM days d
    CROSS JOIN (SELECT unnest(ARRAY['topgg', 'discordforge']) AS source) s
    LEFT JOIN (
        SELECT created_at::date AS day, source,
               COUNT(*)::INT AS votes,
               COUNT(DISTINCT user_id)::INT AS unique_voters
        FROM f GROUP BY 1, 2
    ) v ON v.day = d.day AND v.source = s.source
    ORDER BY d.day, s.source
),
hours AS (
    SELECT h.hour, COALESCE(v.votes, 0) AS votes
    FROM generate_series(0, 23) AS h(hour)
    LEFT JOIN (
        SELECT EXTRACT(HOUR FROM created_at)::INT AS hour, COUNT(*)::INT AS votes
        FROM f GROUP BY 1
    ) v USING (hour)
    ORDER BY h.hour
),
weekdays AS (
    -- ISO: 1 = Monday ... 7 = Sunday
    SELECT wd.dow, COALESCE(v.votes, 0) AS votes
    FROM generate_series(1, 7) AS wd(dow)
    LEFT JOIN (
        SELECT EXTRACT(ISODOW FROM created_at)::INT AS dow, COUNT(*)::INT AS votes
        FROM f GROUP BY 1
    ) v USING (dow)
    ORDER BY wd.dow
),
firsts AS (
    SELECT user_id, MIN(created_at) AS first_at
    FROM botlist_votes WHERE NOT is_test GROUP BY user_id
),
new_returning AS (
    SELECT d.day,
           COUNT(DISTINCT vf.user_id) FILTER (WHERE fs.first_at::date = d.day)::INT AS new_voters,
           COUNT(DISTINCT vf.user_id) FILTER (WHERE fs.first_at::date < d.day)::INT AS returning_voters
    FROM days d
    LEFT JOIN f vf ON vf.created_at::date = d.day
    LEFT JOIN firsts fs ON fs.user_id = vf.user_id
    GROUP BY d.day
    ORDER BY d.day
),
overlap AS (
    -- Which lists each in-window voter used (source filter ignored on purpose)
    SELECT COUNT(*) FILTER (WHERE srcs = ARRAY['topgg'])::INT AS topgg_only,
           COUNT(*) FILTER (WHERE srcs = ARRAY['discordforge'])::INT AS discordforge_only,
           COUNT(*) FILTER (WHERE cardinality(srcs) = 2)::INT AS both
    FROM (
        SELECT user_id, ARRAY_AGG(DISTINCT source ORDER BY source) AS srcs
        FROM botlist_votes
        WHERE NOT is_test AND created_at >= (SELECT ts FROM window_start)
        GROUP BY user_id
    ) x
),
weekend AS (
    SELECT COUNT(*) FILTER (WHERE is_weekend IS TRUE)::INT AS weekend_votes,
           COUNT(*)::INT AS total_votes
    FROM f
),
campaigns AS (
    SELECT query->>'source' AS campaign, COUNT(*)::INT AS votes
    FROM f
    WHERE query ? 'source'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10
)
SELECT jsonb_build_object(
    'days',          (SELECT n FROM bounds),
    'history',       (SELECT COALESCE(jsonb_agg(to_jsonb(h)), '[]'::jsonb) FROM history h),
    'hours',         (SELECT COALESCE(jsonb_agg(to_jsonb(h)), '[]'::jsonb) FROM hours h),
    'weekdays',      (SELECT COALESCE(jsonb_agg(to_jsonb(w)), '[]'::jsonb) FROM weekdays w),
    'new_returning', (SELECT COALESCE(jsonb_agg(to_jsonb(nr)), '[]'::jsonb) FROM new_returning nr),
    'overlap',       (SELECT to_jsonb(o) FROM overlap o),
    'weekend',       (SELECT to_jsonb(w) FROM weekend w),
    'campaigns',     (SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM campaigns c)
);
$$;

REVOKE ALL ON FUNCTION get_botlist_analytics(INT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_botlist_analytics(INT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Voter directory: searchable, sortable, paginated per-voter stats,
--    including the voter's current daily vote streak and the latest weekly/
--    total counters DiscordForge reports. Returns {total, rows}.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_botlist_voter_directory(
    p_days INT DEFAULT 30,
    p_source TEXT DEFAULT NULL,
    p_search TEXT DEFAULT NULL,
    p_sort TEXT DEFAULT 'votes',
    p_limit INT DEFAULT 25,
    p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
WITH bounds AS (
    SELECT LEAST(GREATEST(p_days, 1), 365) AS n
),
f AS (
    SELECT bv.*
    FROM botlist_votes bv
    WHERE NOT bv.is_test
      AND bv.created_at >= (CURRENT_DATE - ((SELECT n FROM bounds) - 1))::timestamptz
      AND (p_source IS NULL OR bv.source = p_source)
),
agg AS (
    SELECT user_id,
           COUNT(*)::INT AS votes,
           SUM(weight)::INT AS weighted_votes,
           ARRAY_AGG(DISTINCT source ORDER BY source) AS sources,
           MIN(created_at) AS first_vote_at,
           MAX(created_at) AS last_botlist_vote_at,
           MAX(username) FILTER (WHERE username IS NOT NULL) AS bl_username,
           MAX(avatar_url) FILTER (WHERE avatar_url IS NOT NULL) AS bl_avatar_url,
           (ARRAY_AGG(weekly_votes ORDER BY created_at DESC) FILTER (WHERE weekly_votes IS NOT NULL))[1] AS df_weekly_votes,
           (ARRAY_AGG(total_votes ORDER BY created_at DESC) FILTER (WHERE total_votes IS NOT NULL))[1] AS df_total_votes
    FROM f
    GROUP BY user_id
),
-- Current streak: consecutive UTC days with >=1 vote (any source, all time),
-- counted back from each user's most recent vote day. Classic prefix trick:
-- ordered desc, a row belongs to the streak iff day = last_day - (rn - 1).
streaks AS (
    SELECT user_id, COUNT(*)::INT AS streak_days
    FROM (
        SELECT user_id, day,
               MAX(day) OVER (PARTITION BY user_id) AS last_day,
               ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY day DESC) AS rn
        FROM (SELECT DISTINCT user_id, created_at::date AS day FROM botlist_votes WHERE NOT is_test) d
    ) x
    WHERE day = last_day - (rn - 1)::INT
    GROUP BY user_id
),
enriched AS (
    SELECT a.user_id,
           COALESCE(u.username, a.bl_username) AS username,
           COALESCE(u.avatar_url, a.bl_avatar_url) AS avatar_url,
           a.votes, a.weighted_votes, a.sources,
           a.first_vote_at, a.last_botlist_vote_at,
           a.df_weekly_votes, a.df_total_votes,
           COALESCE(s.streak_days, 0) AS streak_days,
           u.last_vote_at AS premium_last_vote_at,
           (u.last_vote_at > NOW() - INTERVAL '13 hours') IS TRUE AS premium_active
    FROM agg a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN streaks s ON s.user_id = a.user_id
    WHERE p_search IS NULL OR p_search = ''
       OR a.user_id LIKE p_search || '%'
       OR COALESCE(u.username, a.bl_username) ILIKE '%' || p_search || '%'
),
sorted AS (
    SELECT * FROM enriched
    ORDER BY
        CASE WHEN p_sort = 'votes'  THEN votes END DESC NULLS LAST,
        CASE WHEN p_sort = 'streak' THEN streak_days END DESC NULLS LAST,
        CASE WHEN p_sort = 'weighted' THEN weighted_votes END DESC NULLS LAST,
        last_botlist_vote_at DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
    OFFSET GREATEST(p_offset, 0)
)
SELECT jsonb_build_object(
    'total', (SELECT COUNT(*) FROM enriched),
    'rows',  (SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) FROM sorted s)
);
$$;

REVOKE ALL ON FUNCTION get_botlist_voter_directory(INT, TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_botlist_voter_directory(INT, TEXT, TEXT, TEXT, INT, INT) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Per-poll supporter card: how a poll's voters relate to the bot lists —
--    premium-now count, supporters per list, and the top bot-list supporters
--    among the poll's voters.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_botlist_poll_supporters(p_poll_id TEXT)
RETURNS JSONB
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
WITH pv AS (
    SELECT DISTINCT user_id FROM votes WHERE poll_id = p_poll_id
),
bl AS (
    SELECT bv.user_id,
           ARRAY_AGG(DISTINCT bv.source ORDER BY bv.source) AS sources,
           COUNT(*)::INT AS botlist_votes,
           COUNT(*) FILTER (WHERE bv.created_at > NOW() - INTERVAL '30 days')::INT AS votes_30d,
           MAX(bv.created_at) AS last_botlist_vote_at
    FROM botlist_votes bv
    JOIN pv ON pv.user_id = bv.user_id
    WHERE NOT bv.is_test
    GROUP BY bv.user_id
)
SELECT jsonb_build_object(
    'total_voters',   (SELECT COUNT(*)::INT FROM pv),
    'premium_now',    (SELECT COUNT(*)::INT FROM pv JOIN users u ON u.id = pv.user_id
                       WHERE u.last_vote_at > NOW() - INTERVAL '13 hours'),
    'supporters',     (SELECT COUNT(*)::INT FROM bl),
    'supporters_30d', (SELECT COUNT(*)::INT FROM bl WHERE votes_30d > 0),
    'topgg',          (SELECT COUNT(*)::INT FROM bl WHERE 'topgg' = ANY(sources)),
    'discordforge',   (SELECT COUNT(*)::INT FROM bl WHERE 'discordforge' = ANY(sources)),
    'top_supporters', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
                          SELECT b.user_id,
                                 u.username,
                                 u.avatar_url,
                                 b.botlist_votes,
                                 b.sources,
                                 b.last_botlist_vote_at
                          FROM bl b
                          LEFT JOIN users u ON u.id = b.user_id
                          ORDER BY b.botlist_votes DESC
                          LIMIT 5
                      ) t)
);
$$;

REVOKE ALL ON FUNCTION get_botlist_poll_supporters(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_botlist_poll_supporters(TEXT) TO service_role;
