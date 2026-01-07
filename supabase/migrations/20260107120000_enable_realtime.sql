-- Enable Realtime for specific tables
-- This is necessary for the dashboard to receive live updates

alter publication supabase_realtime add table polls;
alter publication supabase_realtime add table votes;
alter publication supabase_realtime add table guilds;
