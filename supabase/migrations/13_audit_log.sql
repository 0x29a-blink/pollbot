-- Migration: Add audit logging table
-- Created: 2026-01-11

-- Create audit_log table for tracking important actions
CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    action TEXT NOT NULL,          -- e.g. 'poll.create', 'poll.close', 'poll.delete', 'settings.update'
    user_id TEXT NOT NULL,         -- Discord user ID who performed the action
    poll_id TEXT,                  -- Poll ID if applicable
    guild_id TEXT,                 -- Guild ID if applicable
    details JSONB,                 -- Additional details about the action
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_log_poll ON audit_log(poll_id) WHERE poll_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_guild ON audit_log(guild_id) WHERE guild_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

-- RLS policies - only admins can read audit logs
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (for backend writes)
CREATE POLICY "Service role can manage audit_log" ON audit_log
    FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE audit_log IS 'Audit trail for important user actions on polls and settings';
