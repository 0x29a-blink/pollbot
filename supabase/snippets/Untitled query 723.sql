-- Migration 10: Add RPC function for accurate total member count
-- This function calculates the sum of all guild member counts
-- avoiding the Supabase query limit issue

CREATE OR REPLACE FUNCTION get_total_members()
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT COALESCE(SUM(member_count), 0)::BIGINT FROM guilds;
$$;

-- Grant execute permission to public (for dashboard usage)
GRANT EXECUTE ON FUNCTION get_total_members() TO public;
