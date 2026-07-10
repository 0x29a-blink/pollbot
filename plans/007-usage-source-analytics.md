# Plan 007: Track and chart dashboard vs slash-command usage

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e720b35..HEAD -- src/events/interactionCreate.ts src/webapp/pollManagement.ts src/webapp/dashboardAuth.ts schema.sql supabase/migrations dashboard/src/pages/Home.tsx dashboard/src/components/charts`
> Compare "Current state" excerpts on changed files; mismatch = STOP. Changes
> from plans 001/003/004 are expected drift.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW (fire-and-forget instrumentation; must never affect the flows it observes)
- **Depends on**: none (001's migration numbering: use the next free number — see Step 1)
- **Category**: direction (maintainer-requested feature)
- **Planned at**: commit `e720b35`, 2026-07-09

## Why this matters

The maintainer explicitly asked: "how many people use the dashboard vs the
slash commands." Today this is unanswerable — nothing records where an action
originated. Poll creation happens in two places (`src/commands/poll.ts` via
Discord, `src/webapp/pollManagement.ts` POST `/polls` via the dashboard) and
management actions (close/reopen/edit/delete/export) likewise exist on both
surfaces, but the DB rows are identical either way. This plan adds a
lightweight `usage_events` table, instruments both surfaces at their existing
choke points, and charts the comparison on the admin dashboard.

## Current state

- **Bot choke point** — `src/events/interactionCreate.ts:337-338`: every slash
  and context-menu command flows through
  ```ts
  try {
      await command.execute(interaction);
  } catch (error: any) {
  ```
  Votes flow through the select-menu branch: success is the point right after
  `replaceUserVotes` succeeds and the reply is sent (lines 190-194, the
  `logger.info(...voted on poll...)` line). Close/Reopen buttons: lines 16-23.
- **Dashboard choke points** — `src/webapp/pollManagement.ts`:
  `POST /polls` (line 504, success is where it responds 200/201 after the DB
  insert at ~687), `PATCH /polls/:pollId/status` (line 726),
  `PATCH /polls/:pollId` (settings edit, line 1085), `DELETE /polls/:pollId`
  (line 1015). Export: `src/webapp/userPolls.ts` `GET /polls/:pollId/export`
  (line 566). Each handler already resolves the acting user's ID from the
  session (search for `session.user_id` / `permCheck.userId` within the handler).
- **DB conventions** — migrations are manually applied numbered files in
  `supabase/migrations/` (highest at planning time: `18`; plan 001 will take
  `19`), mirrored into `schema.sql`. RPC pattern for anon-readable aggregates
  (from `schema.sql:248-261`): `SECURITY DEFINER`, `REVOKE ALL ... FROM PUBLIC`,
  `GRANT EXECUTE ... TO anon, authenticated, service_role`. The backend
  supabase client uses the service key (RLS-bypassing); the dashboard uses the
  anon key.
- **Chart exemplar** — `dashboard/src/components/charts/VoteHistoryChart.tsx`:
  a self-fetching Recharts component used in `Home.tsx:534` inside the
  admin-only analytics section (`Home.tsx:531-539`). Model the new chart on it.
- **Logging convention** — `logger` from `src/lib/logger`; instrumentation
  failures must be logged at `debug`/`warn`, never thrown.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Backend | `npm run typecheck && npm test && npm run lint` | exit 0 / all pass |
| Dashboard | `cd dashboard && npx tsc -b --noEmit && npm run build` | exit 0 |

## Scope

**In scope**:
- `supabase/migrations/NN_usage_events.sql` (create; NN = next free number)
- `schema.sql` (mirror)
- `src/lib/usageTracker.ts` (create) + `src/lib/usageTracker.test.ts` (create)
- `src/events/interactionCreate.ts` (3 call sites)
- `src/webapp/pollManagement.ts` (4 call sites), `src/webapp/userPolls.ts` (1), `src/webapp/dashboardAuth.ts` (1 — login)
- `dashboard/src/components/charts/UsageSourceChart.tsx` (create)
- `dashboard/src/pages/Home.tsx` (mount the chart in the admin analytics section)

**Out of scope**:
- Any retention/cleanup automation (pg_cron) — note as deferred.
- Tracking reads/page-views; only *actions* are tracked (create, vote,
  close, reopen, edit, delete, export, login).
- Changing any existing table. No `source` column on `polls`/`votes` — the
  events table keeps the concern separate and reversible.

## Git workflow

- Branch: `feat/usage-source-analytics`
- Commit per step; short imperative messages, no AI/agent references.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Migration + schema mirror

Determine the next migration number: `ls supabase/migrations` — if plan 001
landed, `19_guild_left_at.sql` exists and this file is `20_usage_events.sql`;
otherwise use `19_usage_events.sql`. Content:

```sql
-- Usage telemetry: which surface (bot vs dashboard) actions come from.
CREATE TABLE IF NOT EXISTS usage_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('bot', 'dashboard')),
    event_type TEXT NOT NULL,
    guild_id TEXT,
    user_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at DESC);

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON usage_events FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Deliberately NO public read policy: raw rows contain user_ids.

-- Aggregate for the admin dashboard chart (anon key reads aggregates only,
-- matching the get_active_voter_count pattern).
CREATE OR REPLACE FUNCTION get_usage_summary(p_days INT DEFAULT 30)
RETURNS TABLE(day DATE, source TEXT, events BIGINT, unique_users BIGINT)
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    SELECT created_at::DATE AS day, source, COUNT(*)::BIGINT, COUNT(DISTINCT user_id)::BIGINT
    FROM usage_events
    WHERE created_at > NOW() - make_interval(days => LEAST(GREATEST(p_days, 1), 365))
    GROUP BY 1, 2
    ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION get_usage_summary(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_usage_summary(INT) TO anon, authenticated, service_role;
```

Mirror table, index, RLS, and RPC into `schema.sql` in the matching sections.

**Verify**: migration file exists; `grep -c "usage_events" schema.sql` ≥ 3.

### Step 2: Tracker helper

Create `src/lib/usageTracker.ts`:

```ts
import { supabase } from './db';
import { logger } from './logger';

export type UsageSource = 'bot' | 'dashboard';

export interface UsageEvent {
    source: UsageSource;
    event_type: string;   // 'command:poll' | 'vote' | 'poll_create' | 'poll_close' | ...
    guild_id?: string | null;
    user_id?: string | null;
}

/**
 * Fire-and-forget usage telemetry. NEVER awaited by callers and NEVER throws —
 * a telemetry failure must not affect the action being recorded. Safe to call
 * before the usage_events migration is applied (failures are logged at debug).
 */
export function trackUsage(event: UsageEvent): void {
    void supabase
        .from('usage_events')
        .insert({ ...event })
        .then(({ error }) => {
            if (error) logger.debug(`[UsageTracker] insert failed (${event.event_type}):`, error);
        });
}
```

Create `src/lib/usageTracker.test.ts` — with vitest, mock `./db`'s `supabase`
(use `vi.mock`) and assert: `trackUsage` calls
`from('usage_events').insert(...)` with the event fields; an insert error does
not reject/throw (function returns void synchronously). Model mock style on
any existing test that mocks a module; if none does, a straightforward
`vi.mock('./db', ...)` is fine.

**Verify**: `npm test` → all pass.

### Step 3: Instrument the bot

In `src/events/interactionCreate.ts` (import `trackUsage` at top):

1. After `await command.execute(interaction);` (line ~338, inside the `try`):
   ```ts
   trackUsage({ source: 'bot', event_type: `command:${interaction.commandName}`, guild_id: interaction.guildId, user_id: interaction.user.id });
   ```
2. In the vote branch, immediately after the success `editReply` + logger.info
   (~line 194):
   ```ts
   trackUsage({ source: 'bot', event_type: 'vote', guild_id: interaction.guildId, user_id: userId });
   ```
3. In the button branch (lines 16-23), after `setPollStatus` resolves:
   ```ts
   trackUsage({ source: 'bot', event_type: isCloseAction ? 'poll_close' : 'poll_reopen', guild_id: interaction.guildId, user_id: interaction.user.id });
   ```

Do NOT `await` any of these.

**Verify**: `npm run typecheck` → exit 0; `grep -c "trackUsage" src/events/interactionCreate.ts` → 3.

### Step 4: Instrument the dashboard API

Same pattern, `source: 'dashboard'`, placed at each handler's success path
(right before or after the success `res.json(...)`), using the user ID the
handler already resolved:

- `pollManagement.ts` POST `/polls` → `event_type: 'poll_create'`
- `pollManagement.ts` PATCH `/polls/:pollId/status` → `'poll_close'` or `'poll_reopen'` based on the `active` flag
- `pollManagement.ts` PATCH `/polls/:pollId` → `'poll_edit'`
- `pollManagement.ts` DELETE `/polls/:pollId` → `'poll_delete'`
- `userPolls.ts` GET `/polls/:pollId/export` → `'export'`
- `dashboardAuth.ts`: find the OAuth callback's success point (where the
  session row is created after token exchange — search for the insert into
  `dashboard_sessions`) → `event_type: 'login'`, `user_id` = the Discord user
  id just authenticated, `guild_id: null`.

**Verify**: `npm run typecheck` → exit 0;
`grep -c "trackUsage" src/webapp/pollManagement.ts` → 4;
`grep -c "trackUsage" src/webapp/userPolls.ts` → 1;
`grep -c "trackUsage" src/webapp/dashboardAuth.ts` → 1.

### Step 5: Admin chart

Create `dashboard/src/components/charts/UsageSourceChart.tsx` modeled on
`VoteHistoryChart.tsx` (self-fetching, Recharts, same tooltip/container
styling): call `supabase.rpc('get_usage_summary', { p_days: 30 })`, pivot rows
into `[{ day, bot, dashboard, bot_users, dashboard_users }]`, render a
dual-series chart (bot vs dashboard events per day; show unique users in the
tooltip). Title: "Usage by Surface". Handle empty data with the chart
components' existing empty/loading treatment.

Mount it in `dashboard/src/pages/Home.tsx` in the admin analytics section
(lines 531-539) — add it as a third panel; adjust the grid to
`md:grid-cols-2 xl:grid-cols-3` or add a second row, whichever keeps the
existing two charts' size reasonable.

**Verify**: `cd dashboard && npx tsc -b --noEmit && npm run build` → exit 0.

## Test plan

- `src/lib/usageTracker.test.ts` per Step 2.
- Manual (dev stack, after the migration is applied in the dev Supabase):
  run `/poll` and a vote in the dev guild; create + close a poll from the
  dashboard; then `SELECT source, event_type, COUNT(*) FROM usage_events
  GROUP BY 1,2;` shows both sources. Admin Home shows the new chart.
- Regression guard: with the migration NOT applied, all instrumented flows
  still succeed (tracker only logs at debug).

## Done criteria

- [ ] `npm run typecheck && npm test && npm run lint` exit 0
- [ ] `cd dashboard && npx tsc -b --noEmit && npm run build` exits 0
- [ ] Migration file + `schema.sql` mirror exist; RPC has REVOKE/GRANT lines
- [ ] `grep -rn "await trackUsage" src/` → no matches (fire-and-forget invariant)
- [ ] Grep counts from Steps 3-4 all match
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated; report notes the manual migration

## STOP conditions

Stop and report back if:

- You cannot locate the `dashboard_sessions` insert in `dashboardAuth.ts`
  within 15 minutes — ship the plan without the login event and say so, do not
  guess at the OAuth flow.
- Any instrumented handler's success path is ambiguous (multiple exits) —
  instrument the unambiguous ones and report the rest.
- The vitest mock of `src/lib/db` proves impossible without restructuring
  `db.ts` — skip the unit test, keep the manual test, and report.

## Maintenance notes

- `usage_events` grows unboundedly (~1 row per action). At this bot's scale
  that's fine for a long time; when it isn't, add a monthly cleanup
  (`DELETE WHERE created_at < NOW() - INTERVAL '13 months'`) — deferred
  deliberately.
- The RPC is readable with the anon key (aggregates only, no user_ids) —
  consistent with `get_active_voter_count`. If usage data ever becomes
  sensitive, move the chart behind the authenticated API instead.
- New actions (e.g. plan 005's auto-close) should NOT be tracked as usage —
  they're system-initiated; only user actions belong here. If auto-close
  telemetry is wanted later, use a distinct source value.
