-- Admin dashboard analytics RPCs. All return aggregates only (counts per
-- day/hour/guild — never per-user rows), so anon may execute them, matching
-- the get_usage_summary / get_active_voter_count pattern.
--
-- Replaces two client-side aggregations that silently broke at PostgREST's
-- 1000-row response cap: the Voting Trends chart (raw votes) and the Top
-- Creators leaderboard (raw polls).
--
-- Numbered 23: 22_api_role_grants.sql is a local-dev-only fix that is not
-- applied to production (the history already skips 13).

-- Votes, unique voters, and polls created per day. Zero-filled so charts get
-- one row per day even with no activity.
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

-- Global vote volume by hour of day (UTC), zero-filled 0-23.
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

-- Most active servers by vote volume. Guild names are already public-readable
-- via the guilds table; this adds only aggregate counts. Left guilds excluded.
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

-- Top poll creators, all time. creator_id is already public-readable via the
-- polls table; this replaces a client-side tally that capped at 1000 rows.
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
