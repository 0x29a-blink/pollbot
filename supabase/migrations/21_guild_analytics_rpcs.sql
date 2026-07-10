-- Premium Vote Analytics RPCs. All service_role ONLY — top voters returns
-- user_ids, and per the repo rule the dashboard must reach users/votes data
-- through the authenticated API, never the anon key.

-- Votes per day for a guild (counts only).
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

-- Vote volume by hour-of-day (UTC) — "peak voting times".
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

-- Most active voters (ids + counts; the API enriches names). service_role ONLY.
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
