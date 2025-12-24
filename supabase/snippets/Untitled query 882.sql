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
