-- Migration: Add guild caching to dashboard sessions
-- Caches user's Discord guilds to prevent rate limiting

ALTER TABLE dashboard_sessions 
    ADD COLUMN IF NOT EXISTS cached_guilds JSONB,
    ADD COLUMN IF NOT EXISTS guilds_cached_at TIMESTAMPTZ;

-- Index for faster cache expiry lookups
CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_guilds_cached_at 
    ON dashboard_sessions(guilds_cached_at);
