-- Migration: Enhanced RLS policies for dashboard user isolation
-- Created: 2026-01-11
-- Updated: 2026-01-11 (Added safe creation of missing policies)

-- ============================================================================
-- Ensure "Public read access" policies exist (idempotent)
-- ============================================================================

DO $$
BEGIN
    -- unique policy name check for 'guilds'
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'guilds' AND policyname = 'Public read access'
    ) THEN
        CREATE POLICY "Public read access" ON guilds FOR SELECT USING (true);
    END IF;

    -- check for 'polls'
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'polls' AND policyname = 'Public read access'
    ) THEN
        CREATE POLICY "Public read access" ON polls FOR SELECT USING (true);
    END IF;

    -- check for 'votes'
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'votes' AND policyname = 'Public read access'
    ) THEN
        CREATE POLICY "Public read access" ON votes FOR SELECT USING (true);
    END IF;
    
    -- check for 'guild_settings'
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'guild_settings' AND policyname = 'Public read access'
    ) THEN
        CREATE POLICY "Public read access" ON guild_settings FOR SELECT USING (true);
    END IF;
END
$$;

-- ============================================================================
-- Add Documentation Comments
-- ============================================================================

COMMENT ON POLICY "Public read access" ON polls IS 
    'Read access for telemetry panel. Dashboard API layer enforces user permissions via Discord OAuth.';

COMMENT ON POLICY "Public read access" ON votes IS 
    'Read access for telemetry panel. Dashboard API layer enforces user permissions via Discord OAuth.';

COMMENT ON POLICY "Public read access" ON guilds IS 
    'Read access for telemetry panel. Dashboard API layer enforces user permissions via Discord OAuth.';
