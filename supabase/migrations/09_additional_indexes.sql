-- Migration 09: Add additional indexes for common queries
-- These indexes improve performance for dashboard and API queries

-- Index for filtering polls by guild (used in UserServerView, PollsView)
CREATE INDEX IF NOT EXISTS idx_polls_guild_id ON polls(guild_id);

-- Index for filtering polls by creator (Top Creators feature)
CREATE INDEX IF NOT EXISTS idx_polls_creator_id ON polls(creator_id);

-- Index for sorting by created_at
CREATE INDEX IF NOT EXISTS idx_polls_created_at ON polls(created_at DESC);
