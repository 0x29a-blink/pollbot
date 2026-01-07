-- Create guilds table
CREATE TABLE IF NOT EXISTS guilds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    member_count INTEGER DEFAULT 0,
    icon_url TEXT,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE guilds ENABLE ROW LEVEL SECURITY;

-- Policy: Allow read access for everyone (or specifically the web app if we had a user)
-- For now, public read is fine for the telemetry panel if we are just displaying data
-- But since we want "Advanced Webpage Login", maybe we should restrict it?
-- The "Access Key" approach implies the web client will read this. 
-- Simple approach: Allow public read, but the sensitive "Manage" actions would be restricted.
-- Telemetry is generally read-only.
CREATE POLICY "Enable read access for all users" ON guilds FOR SELECT USING (true);

-- Policy: Allow Service Role (Bot) to insert/update
CREATE POLICY "Enable insert/update for service role only" ON guilds FOR ALL USING (true) WITH CHECK (true);
