-- Track guilds the bot has left instead of counting them forever.
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;

COMMENT ON COLUMN guilds.left_at IS 'Set when the bot leaves the guild; NULL while the bot is a member. Cleared on re-join.';

CREATE INDEX IF NOT EXISTS idx_guilds_left_at ON guilds(left_at) WHERE left_at IS NOT NULL;

-- Exclude left guilds from the member total.
CREATE OR REPLACE FUNCTION get_total_members()
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT COALESCE(SUM(member_count), 0)::BIGINT FROM guilds WHERE left_at IS NULL;
$$;

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
