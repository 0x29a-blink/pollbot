-- 05_realtime.sql
-- Enable Supabase Realtime on tables

ALTER PUBLICATION supabase_realtime ADD TABLE polls;
ALTER PUBLICATION supabase_realtime ADD TABLE global_stats;
