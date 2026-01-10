-- 03_policies.sql
-- Row Level Security policies for all tables

-- ============================================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================================

ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE guilds ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- POLICIES: Allow service_role full access (bot uses service key)
-- Note: service_role bypasses RLS, but explicit policies are best practice
-- ============================================================================

-- polls: service_role full access
CREATE POLICY "Service role full access" ON polls
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- votes: service_role full access
CREATE POLICY "Service role full access" ON votes
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- global_stats: service_role full access
CREATE POLICY "Service role full access" ON global_stats
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- users: service_role full access
CREATE POLICY "Service role full access" ON users
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- POLICIES: Public read access for telemetry panel (uses anon key)
-- ============================================================================

CREATE POLICY "Public read access" ON polls FOR SELECT USING (true);
CREATE POLICY "Public read access" ON votes FOR SELECT USING (true);
CREATE POLICY "Public read access" ON global_stats FOR SELECT USING (true);
CREATE POLICY "Public read access" ON users FOR SELECT USING (true);

-- ============================================================================
-- POLICIES: guild_settings (fix permissive policy warning)
-- ============================================================================

-- Drop old permissive policies
DROP POLICY IF EXISTS "Enable read access for all users" ON guild_settings;
DROP POLICY IF EXISTS "Enable insert/update for service role only" ON guild_settings;

-- Read access for authenticated/anon (telemetry panel needs this)
CREATE POLICY "Public read access" ON guild_settings
    FOR SELECT
    USING (true);

-- Write access only for service_role
CREATE POLICY "Service role write access" ON guild_settings
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- POLICIES: guilds (fix permissive policy warning)
-- ============================================================================

-- Drop old permissive policies
DROP POLICY IF EXISTS "Enable read access for all users" ON guilds;
DROP POLICY IF EXISTS "Enable insert/update for service role only" ON guilds;

-- Read access for authenticated/anon (telemetry panel needs this)
CREATE POLICY "Public read access" ON guilds
    FOR SELECT
    USING (true);

-- Write access only for service_role
CREATE POLICY "Service role write access" ON guilds
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
