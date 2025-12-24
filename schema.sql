-- Create the polls table
CREATE TABLE IF NOT EXISTS polls (
    message_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Enable Row Level Security (RLS) if you want to restrict access, 
-- but for a bot with a service key, it might not be strictly necessary unless using public client.
-- ALTER TABLE polls ENABLE ROW LEVEL SECURITY;


CREATE TABLE IF NOT EXISTS votes (
    poll_id TEXT NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    option_index INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (poll_id, user_id, option_index)
);

-- Index for faster count aggregation
CREATE INDEX IF NOT EXISTS idx_votes_poll_id ON votes(poll_id);

create table if not exists guild_settings (
    guild_id text primary key,
    allow_poll_buttons boolean default true,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS Policies (Optional but good practice if exposed, though here we use service key mostly or bot logic)
alter table guild_settings enable row level security;

create policy "Enable read access for all users" on guild_settings
    for select using (true);

-- Ensure we can update it
create policy "Enable insert/update for service role only" on guild_settings
    for all using (true) with check (true);
