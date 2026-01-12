-- Migration: Enhanced RLS policies for dashboard user isolation
-- Created: 2026-01-11
-- 
-- Note: The dashboard uses service_role key, so these policies are primarily
-- for documentation and defense-in-depth. The actual user authorization is
-- performed in the API layer (verifying session + Discord permissions).
--
-- For true multi-tenant isolation, we would need to use Supabase Auth or
-- pass user context via RLS. Since we use Discord OAuth with custom sessions,
-- the authorization is handled at the API layer, not the database layer.

-- Create a function to check if a user has permissions on a guild
-- This would require passing the user_id via app.set_config or JWT claims
-- For now, we document the intended behavior

COMMENT ON POLICY "Public read access" ON polls IS 
    'Read access for telemetry panel. Dashboard API layer enforces user permissions via Discord OAuth.';

COMMENT ON POLICY "Public read access" ON votes IS 
    'Read access for telemetry panel. Dashboard API layer enforces user permissions via Discord OAuth.';

COMMENT ON POLICY "Public read access" ON guilds IS 
    'Read access for telemetry panel. Dashboard API layer enforces user permissions via Discord OAuth.';

-- Future enhancement: If switching to Supabase Auth, replace public read policies with:
-- CREATE POLICY "User can read polls in their guilds" ON polls
--     FOR SELECT
--     USING (
--         guild_id IN (
--             SELECT guild_id FROM user_guild_permissions 
--             WHERE user_id = auth.uid() AND permission = 'MANAGE_GUILD'
--         )
--     );
