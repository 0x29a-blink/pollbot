-- Usage telemetry: which surface (bot vs dashboard) actions come from.
CREATE TABLE IF NOT EXISTS usage_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('bot', 'dashboard')),
    event_type TEXT NOT NULL,
    guild_id TEXT,
    user_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at DESC);

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON usage_events FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Deliberately NO public read policy: raw rows contain user_ids.

-- Aggregate for the admin dashboard chart (anon key reads aggregates only,
-- matching the get_active_voter_count pattern).
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
