-- 04_indexes.sql
-- Performance indexes

CREATE INDEX IF NOT EXISTS idx_votes_poll_id ON votes(poll_id);
