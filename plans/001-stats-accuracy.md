# Plan 001: Make server & member counts consistent between /stats and the admin dashboard

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e720b35..HEAD -- src/services/GuildSyncService.ts src/events/guildDelete.ts src/commands/stats.ts src/lib/guildUtils.ts dashboard/src/pages/Home.tsx schema.sql supabase/migrations src/locales`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `e720b35`, 2026-07-09

## Why this matters

The admin dashboard's "Active Servers" number and the `/stats` command's
"Active Servers" number disagree, and the gap grows forever. Four verified
causes:

1. When the bot leaves a guild, its row in the `guilds` table is never deleted
   or marked — the dashboard counts every guild the bot has *ever* joined.
2. `/stats` deliberately renders the **all-time peak** (`peak_active_servers`),
   while the dashboard renders a current DB row count, under the same label.
3. The stored `member_count` per guild only refreshes at bot restart: the
   `GuildMemberAdd`/`GuildMemberRemove` listeners in `GuildSyncService` never
   fire because the client does not request the privileged `GuildMembers`
   intent, and there is no periodic re-sync.
4. The peak update in `/stats` is a check-then-act race with a fire-and-forget
   write.

After this plan: left guilds are excluded from all dashboard totals, member
counts refresh hourly, the peak update is atomic, and every surface is labeled
for what it actually shows.

## Current state

Files and their roles:

- `src/services/GuildSyncService.ts` — event-driven guild → DB sync (runs on **each shard**). The `GuildDelete` handler is a no-op; two member listeners are dead code.
- `src/events/guildDelete.ts` — second `GuildDelete` handler; deletes the guild's polls only.
- `src/lib/guildUtils.ts` — `upsertGuildRow()` / `guildToRow()`, the single write path to `guilds`.
- `src/commands/stats.ts` — `/stats` command; computes live cross-shard guild count, updates + renders the peak.
- `dashboard/src/pages/Home.tsx` — admin dashboard; reads `guilds` row count and `get_total_members()` RPC.
- `schema.sql` + `supabase/migrations/` — canonical schema; migrations are numbered files **applied manually in the Supabase SQL editor** (highest existing: `18_public_stat_rpcs.sql`).
- `src/locales/en.json` and `src/locales/es-ES.json` — i18n strings; `stats.active_servers` is at `en.json:238` ("Active Servers").

Key excerpts (verified at commit `e720b35`):

`src/services/GuildSyncService.ts:24-30` — the no-op leave handler:
```ts
this.client.on(Events.GuildDelete, (guild) => {
    logger.info(`[GuildSync] Left guild: ${guild.name} (${guild.id})`);
    // Optional: Delete from DB or mark as inactive?
    // For now, we'll leave it but maybe we could update a status if we had one.
```

`src/services/GuildSyncService.ts:39-45` — dead listeners (the client in
`src/bot.ts:27-31` requests only `GatewayIntentBits.Guilds` and
`GatewayIntentBits.GuildMessages`, so these events never arrive):
```ts
this.client.on(Events.GuildMemberAdd, (member) => {
    this.syncGuild(member.guild);
});
this.client.on(Events.GuildMemberRemove, (member) => {
    this.syncGuild(member.guild);
});
```

`src/events/guildDelete.ts:12-15` — the other leave handler (deletes polls, not the guild row):
```ts
const { error } = await supabase
    .from('polls')
    .delete()
    .eq('guild_id', guild.id);
```

`src/commands/stats.ts:49-58` — racy peak update:
```ts
if (activeServers > peakActiveServers) {
    peakActiveServers = activeServers;
    // Fire and forget update
    supabase.from('global_stats')
        .update({ peak_active_servers: peakActiveServers })
        .eq('id', 1)
```

`src/commands/stats.ts:112-118` — the peak is what gets rendered:
```ts
const buffer = await Renderer.renderStats({
    ...
    activeServers: peakActiveServers,
```

`dashboard/src/pages/Home.tsx:97-106` — dashboard totals:
```ts
const { count: totalGuildCount } = await supabase.from('guilds').select('id', { count: 'exact', head: true });
setTotalServerCount(totalGuildCount || 0);
const { data: memberSumData } = await supabase.rpc('get_total_members');
if (memberSumData !== null) {
    setTotalMembers(memberSumData);
}
```

`schema.sql:211-218` — the member-sum RPC (sums ALL rows):
```sql
CREATE OR REPLACE FUNCTION get_total_members()
RETURNS BIGINT ... AS $$
    SELECT COALESCE(SUM(member_count), 0)::BIGINT FROM guilds;
$$;
```

Repo conventions that apply:

- 4-space indent TypeScript; `logger` from `src/lib/logger` for all logging.
- Migrations: add a new numbered file in `supabase/migrations/` AND mirror the change into `schema.sql`. New RPCs that read `users`/`votes` (or that shouldn't be public) must `REVOKE ALL ... FROM PUBLIC` and grant only needed roles — see `schema.sql:243-244` for the exemplar.
- Unit tests: vitest, colocated as `src/**/*.test.ts` — `src/lib/voteUtils.test.ts` is the structural exemplar.
- **The bot process cannot apply migrations.** You write the SQL files; a human runs them in the Supabase SQL editor. Code that depends on a new column/RPC must degrade gracefully (log an error) until the migration is applied.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck (backend) | `npm run typecheck` | exit 0 |
| Tests | `npm test` | all pass |
| Lint | `npm run lint` | exit 0 (warnings allowed) |
| Dashboard typecheck+build | `cd dashboard && npx tsc -b --noEmit && npm run build` | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `supabase/migrations/19_guild_left_at.sql` (create)
- `schema.sql`
- `src/lib/guildUtils.ts`
- `src/lib/shardUtils.ts` (create) + `src/lib/shardUtils.test.ts` (create)
- `src/services/GuildSyncService.ts`
- `src/events/guildDelete.ts`
- `src/commands/stats.ts`
- `src/locales/en.json`, `src/locales/es-ES.json` (one label each)
- `dashboard/src/pages/Home.tsx` (the `fetchData` totals + the "Active Servers" StatsCard label only)

**Out of scope** (do NOT touch):
- `src/bot.ts` — do NOT add the `GuildMembers` intent; it is privileged and requires a Dev Portal change the maintainer must make deliberately.
- `src/lib/voteUtils.ts`, any vote-counting logic.
- The dashboard realtime subscriptions in `Home.tsx:63-77` (a separate known issue).
- Deleting `guilds` rows. We soft-mark with `left_at` — `polls.guild_id REFERENCES guilds(id)` has no `ON DELETE CASCADE`, so hard deletes can violate the FK.

## Git workflow

- Branch: `fix/stats-accuracy`
- Commit style: short imperative sentences, matching `git log` (e.g. "Fix typechecks under fresh dependency resolution"). No AI/agent references anywhere in commit messages or PR text.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Migration — `left_at` column, filtered RPCs, atomic peak RPC

Create `supabase/migrations/19_guild_left_at.sql`:

```sql
-- Track guilds the bot has left instead of counting them forever.
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;

COMMENT ON COLUMN guilds.left_at IS 'Set when the bot leaves the guild; NULL while the bot is a member. Cleared on re-join.';

CREATE INDEX IF NOT EXISTS idx_guilds_left_at ON guilds(left_at) WHERE left_at IS NOT NULL;

-- Exclude left guilds from the member total.
CREATE OR REPLACE FUNCTION get_total_members()
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT COALESCE(SUM(member_count), 0)::BIGINT FROM guilds WHERE left_at IS NULL;
$$;

-- Atomic peak update: GREATEST server-side, no read-modify-write race.
CREATE OR REPLACE FUNCTION bump_peak_active_servers(p_current INT)
RETURNS INT
LANGUAGE SQL
AS $$
    UPDATE global_stats
    SET peak_active_servers = GREATEST(peak_active_servers, p_current),
        last_updated = NOW()
    WHERE id = 1
    RETURNING peak_active_servers;
$$;

REVOKE ALL ON FUNCTION bump_peak_active_servers(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bump_peak_active_servers(INT) TO service_role;
```

Mirror all of the above into `schema.sql`: add `left_at TIMESTAMPTZ` to the
`guilds` table definition (after `updated_at`), add the index in the INDEXES
section, replace the `get_total_members` body, and add
`bump_peak_active_servers` in the RPC section following the `replace_vote`
REVOKE/GRANT pattern at `schema.sql:243-244`.

**Verify**: `git diff schema.sql` shows the three changes; the migration file exists. `npm run typecheck` → exit 0 (no TS touched yet, sanity baseline).

### Step 2: Shard-ownership helper

Create `src/lib/shardUtils.ts`. Discord assigns a guild to shard
`(guild_id >> 22) % shardCount`. Each shard process must only reconcile rows
for guilds it owns (its cache says nothing about other shards' guilds):

```ts
/**
 * Discord's sharding formula: which shard a guild belongs to.
 * guildId is a snowflake (numeric string), so use BigInt.
 */
export function shardIdForGuild(guildId: string, shardCount: number): number {
    return Number((BigInt(guildId) >> 22n) % BigInt(shardCount));
}
```

Create `src/lib/shardUtils.test.ts` (model the file layout on
`src/lib/voteUtils.test.ts`): assert a few known values, e.g.
`shardIdForGuild('175928847299117063', 1) === 0`, that two different snowflakes
map into `[0, shardCount)` for counts 2 and 16, and that the function is stable
for the same input.

**Verify**: `npm test` → all pass, including the new file.

### Step 3: Consolidate guild-leave handling into `src/events/guildDelete.ts`

In `src/events/guildDelete.ts`, after the existing polls delete, mark the
guild as left:

```ts
const { error: guildError } = await supabase
    .from('guilds')
    .update({ left_at: new Date().toISOString() })
    .eq('id', guild.id);
if (guildError) {
    logger.error(`[Persistence] Failed to mark guild ${guild.id} as left:`, guildError);
}
```

In `src/services/GuildSyncService.ts`, delete the entire no-op
`Events.GuildDelete` listener (lines 24-30) and replace it with a one-line
comment pointing at `src/events/guildDelete.ts` so future readers find the
single handler.

**Verify**: `grep -n "GuildDelete" src/services/GuildSyncService.ts` → only the comment; `npm run typecheck` → exit 0.

### Step 4: Clear `left_at` on (re)join

In `src/lib/guildUtils.ts`, add `left_at: null` to the row produced by
`guildToRow()` (and `left_at?: string | null` to the `GuildRow` interface).
Every sync path (`ClientReady` full sync, `GuildCreate`, `GuildUpdate`, manual
admin sync) goes through `upsertGuildRow`, so a re-joined or still-present
guild is automatically un-marked. This is deliberate: the upsert is the single
write path (see the comment at `guildUtils.ts:19-22`) — do not add a separate
"clear" query anywhere else.

**Verify**: `npm run typecheck` → exit 0. `npm test` → pass.

### Step 5: Periodic sync + left-guild reconciliation in `GuildSyncService`

In `src/services/GuildSyncService.ts`:

1. Remove the dead `Events.GuildMemberAdd` / `Events.GuildMemberRemove`
   listeners (lines 39-45) and their comment. Replace with a comment noting
   member counts refresh via the periodic sync because the privileged
   `GuildMembers` intent is not requested.
2. In `init()`, inside the `ClientReady` handler, start an hourly timer:
   `setInterval(() => this.syncAllGuilds().then(() => this.reconcileLeftGuilds()), 60 * 60 * 1000)`.
   Also call `this.reconcileLeftGuilds()` once after the initial
   `syncAllGuilds()`. Store the interval handle; call `.unref()` on it so it
   never blocks shutdown.
3. Add the reconciler — it must only touch guilds THIS shard owns:

```ts
import { shardIdForGuild } from '../lib/shardUtils';

private async reconcileLeftGuilds() {
    const shard = this.client.shard;
    const shardIds = shard?.ids ?? [0];
    const shardCount = shard?.count ?? 1;

    const { data: rows, error } = await supabase
        .from('guilds')
        .select('id')
        .is('left_at', null);
    if (error || !rows) {
        logger.error('[GuildSync] Reconcile query failed:', error);
        return;
    }

    const stale = rows.filter(r =>
        shardIds.includes(shardIdForGuild(r.id, shardCount)) &&
        !this.client.guilds.cache.has(r.id)
    );
    if (stale.length === 0) return;

    const { error: updErr } = await supabase
        .from('guilds')
        .update({ left_at: new Date().toISOString() })
        .in('id', stale.map(r => r.id));
    if (updErr) {
        logger.error('[GuildSync] Failed to mark left guilds:', updErr);
    } else {
        logger.info(`[GuildSync] Marked ${stale.length} guild(s) as left during reconcile.`);
    }
}
```

You will need `import { supabase } from '../lib/db';` in this file (it does
not currently import it).

Note: `reconcileLeftGuilds` runs on every shard but each shard filters to its
own guilds, so shards never fight over rows.

**Verify**: `npm run typecheck` → exit 0; `npm run lint` → exit 0.

### Step 6: Atomic, awaited peak update in `/stats`

In `src/commands/stats.ts`, replace the block at lines 48-58 (the
`if (activeServers > peakActiveServers)` check-then-act) with a single awaited
RPC call:

```ts
// Atomically raise the stored peak (GREATEST server-side) and read it back.
const { data: newPeak, error: peakError } = await supabase
    .rpc('bump_peak_active_servers', { p_current: activeServers });
if (peakError) {
    logger.error('Failed to update peak_active_servers:', peakError);
} else if (typeof newPeak === 'number') {
    peakActiveServers = newPeak;
}
```

Keep the fallback `peakActiveServers` from `global_stats` (line 32) so the
command still renders if the RPC is missing (migration not yet applied).

**Verify**: `npm run typecheck` → exit 0.

### Step 7: Label the peak as a peak

In `src/locales/en.json` (key `stats.active_servers`, line ~238) change the
value to `"Active Servers (Peak)"`. Make the equivalent change to the same key
in `src/locales/es-ES.json` (e.g. `"Servidores activos (máximo)"` — match the
file's existing capitalization style). Do not rename the key.

**Verify**: `npm test` → pass (i18n tests, if any, still green); `grep -n "Peak" src/locales/en.json` → 1 match.

### Step 8: Dashboard — count only current guilds, coerce the member sum

In `dashboard/src/pages/Home.tsx` `fetchData()` (lines 97-106):

1. Server count: add the filter —
   `supabase.from('guilds').select('id', { count: 'exact', head: true }).is('left_at', null)`
2. Member sum: coerce like the adjacent `activeVoterCount` does at line 94
   (`setTotalMembers(Number(memberSumData))` — Postgres BIGINT can arrive as a
   string).
3. The StatsCard at lines 521-527: change `title="Active Servers"` to
   `title="Servers"` and `subLabel` to
   `` `${totalMembers.toLocaleString()} members` `` — the number includes bots
   and offline users, so "Users" over-promises. Leave icon/color as is.

Also check `fetchGuildsList` in the same file: if it lists guilds for the
server browser without a `left_at` filter, add `.is('left_at', null)` there
too so left guilds drop out of the browser and "Top Servers" leaderboard.

**Verify**: `cd dashboard && npx tsc -b --noEmit && npm run build` → exit 0.

## Test plan

- `src/lib/shardUtils.test.ts` (new): shard formula correctness (see Step 2).
- Manual (requires `DEV_ONLY_MODE` + `DEV_GUILD_ID` test guild — NEVER test
  against production, per CLAUDE.md): after the migration is applied, kick the
  bot from the test guild → the guild's row gains `left_at`; re-invite → `left_at`
  clears on the `GuildCreate` sync; dashboard totals exclude the guild while left.
- `npm test` → all pass including new tests.

## Done criteria

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0; `shardUtils.test.ts` exists and passes
- [ ] `npm run lint` exits 0
- [ ] `cd dashboard && npx tsc -b --noEmit && npm run build` exits 0
- [ ] `supabase/migrations/19_guild_left_at.sql` exists; `grep -c "left_at" schema.sql` ≥ 3
- [ ] `grep -n "GuildMemberAdd" src/services/GuildSyncService.ts` → no listener registration
- [ ] `grep -n "Fire and forget" src/commands/stats.ts` → no matches
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" don't match the live code (drift).
- A migration numbered `19_` already exists in `supabase/migrations/` (renumber only after confirming with the operator).
- You find code elsewhere that hard-deletes `guilds` rows (would conflict with the soft-mark design).
- `client.shard` typing makes `ids`/`count` unavailable in `GuildSyncService` — do not hack around it with `any` beyond the file's existing tolerance; report.
- You are tempted to add the `GuildMembers` intent to fix member freshness — that is explicitly out of scope.

## Maintenance notes

- **The migration must be run manually** in the Supabase SQL editor before the
  new code paths fully work. Until then: `left_at` filter queries fail
  (dashboard falls back to whatever the query returns — verify it degrades to
  the old behavior, not a crash), and `bump_peak_active_servers` errors are
  logged but `/stats` still renders.
- If true "active member" counts are ever wanted, that requires the privileged
  `GuildMembers`/`GuildPresences` intents and Discord verification at scale —
  a product decision, not a bug fix.
- Reviewer should scrutinize: the shard-ownership filter in
  `reconcileLeftGuilds` (marking guilds owned by *other* shards would be a
  serious regression), and that `guildToRow`'s `left_at: null` doesn't clobber
  anything else (it shouldn't — upsert sets all listed columns).
- Deferred: debouncing the dashboard realtime refetch storm (`Home.tsx:63-77`)
  — recorded in `plans/README.md` as a future candidate.
