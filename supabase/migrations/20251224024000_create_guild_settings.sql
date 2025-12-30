create table if not exists guild_settings (
    guild_id text primary key,
    allow_poll_buttons boolean default true,
    locale text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS Policies for guild_settings
alter table guild_settings enable row level security;

-- Drop existing policies if they exist (handling re-runs gracefully with DO block not strictly needed for fresh migrations but good for "reset" mental model consistency, though in migration files we usually assume fresh state. 
-- However, schema.sql had DO blocks. Here we will keep it simple as standard migrations usually just CREATE.
-- But to match schema.sql exactly let's check policies existence or just use CREATE POLICY IF NOT EXISTS if PG version supports it (PG16 does, Supabase usually is 15+). 
-- actually, standard migrations run on fresh DBs mostly. I will use the simple CREATE POLICY syntax but updating names to match schema.sql if they differ slightly or just ensure logic is same.

-- schema.sql used "Enable read access for all users" and "Enable insert/update for service role only"
create policy "Enable read access for all users" on guild_settings
    for select using (true);

create policy "Enable insert/update for service role only" on guild_settings
    for all using (true) with check (true);
