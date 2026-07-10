-- Migration 18: Aggregate RPCs for the public dashboard
--
-- These SECURITY DEFINER functions return ONLY aggregate numbers, so the public
-- landing page can show its stats without the anon key needing blanket SELECT on
-- the `users` and `votes` tables.

-- Number of users who voted (on Top.gg) within the last 13 hours — used for the
-- "active premium users" stat. Returns a count, never any user identifiers.
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

-- Vote counts grouped by guild — used for the "vote/poll ratio" server sort.
-- Returns only (guild_id, vote_count) aggregates, never per-vote user data.
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
