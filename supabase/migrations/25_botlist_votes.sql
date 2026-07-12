-- Bot-list vote events: one row per vote received from a bot listing site
-- (Top.gg or DiscordForge). Until now votes only overwrote users.last_vote_at,
-- so there was no history to analyze. This table keeps the full event stream —
-- including the extra voter metadata each site sends (username/avatar from
-- Top.gg v1, weekly/total vote counts from DiscordForge) — and powers the
-- dashboard's voter analytics.
--
-- users.last_vote_at remains the source of truth for the premium window; the
-- webhook updates both.

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

CREATE INDEX IF NOT EXISTS idx_botlist_votes_created_at ON botlist_votes(created_at);
CREATE INDEX IF NOT EXISTS idx_botlist_votes_user_id ON botlist_votes(user_id, created_at);

-- Raw rows contain per-user data: service_role only, like users/votes.
ALTER TABLE botlist_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON botlist_votes;
CREATE POLICY "Service role full access" ON botlist_votes
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- Analytics RPCs
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

REVOKE ALL ON FUNCTION get_top_botlist_voters(INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_top_botlist_voters(INT, INT) TO service_role;
