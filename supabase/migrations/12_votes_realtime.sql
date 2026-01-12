-- Migration: Add votes table to Realtime publication
-- Created: 2026-01-11

-- Add votes table to supabase_realtime publication for live vote updates
-- This allows the dashboard to receive real-time vote updates without polling
ALTER PUBLICATION supabase_realtime ADD TABLE votes;
