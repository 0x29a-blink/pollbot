# Plan 005: Ship poll auto-close (Phase 1 of the scheduling plan)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e720b35..HEAD -- src/commands/poll.ts src/lib/pollManager.ts src/webapp/pollManagement.ts src/bot.ts schema.sql dashboard/src/components/CreatePollModal.tsx`
> Compare "Current state" excerpts on any changed file; mismatch = STOP.
> Exception: changes from plan 001 (`src/lib/shardUtils.ts` existing) are
> expected and welcome.

## Status

- **Priority**: P2
- **Effort**: M-L
- **Risk**: MED (touches live poll lifecycle)
- **Depends on**: plans/001-stats-accuracy.md — only for `src/lib/shardUtils.ts`; if 001 hasn't run, create that file exactly as its Step 2 specifies.
- **Category**: direction (feature)
- **Planned at**: commit `e720b35`, 2026-07-09

## Why this matters

Auto-closing polls ("closes in 24h") is the most-prepared unshipped feature in
this repo: `polls.ends_at` and `polls.scheduled_start` columns exist
(`schema.sql:33-39`), partial indexes were built for the scheduler's exact
query (`schema.sql:122-127`, migration `11_poll_scheduling.sql`), and
`docs/poll-scheduling-plan.md` is a maintainer-authored implementation plan.
Zero code reads these columns today — poll creators must manually `/close`
every poll. This plan implements **Phase 1 (auto-close) only**, per that doc's
own recommendation. Scheduled start (Phase 2) is explicitly out of scope.

## Current state

Read `docs/poll-scheduling-plan.md` in full before starting — it is the
product spec this plan implements; where it and this plan differ, this plan
wins (differences are called out below).

Files and roles:

- `schema.sql:33-39` — columns already exist:
  ```sql
  ends_at TIMESTAMPTZ,
  scheduled_start TIMESTAMPTZ
  ```
  with partial index `idx_polls_ends_at ON polls(ends_at) WHERE ends_at IS NOT NULL AND active = true` (`schema.sql:123-124`). **No migration is needed for this plan.**
- `src/commands/poll.ts` — `/poll` slash command. Options are defined at lines
  10-56 (title, items, max_votes, min_votes, description, allow_exports,
  public, close_button, thread, allowed_role). The DB insert builds `pollRow`
  at lines ~310-326 (`settings: { public, allow_thread, allow_close, ... }`,
  `created_at`) and inserts at line 328 with an FK-retry at 332-337.
- `src/webapp/pollManagement.ts` — dashboard poll creation.
  `CreatePollRequest` interface at lines 481-498; settings assembled at
  585-595; `pollRow` at ~681; insert at 687 with FK-retry at 698.
- `src/lib/pollManager.ts` — `PollManager.setPollStatus(interaction, pollId, active)`
  closes/reopens a poll but is **coupled to an interaction** (permission
  check, ephemeral replies, `interaction.client`). The reusable pieces:
  guild-settings fetch (lines 43-54), `aggregateVotes` + abort-on-error
  (57-67), render options (89-103), closed-state components — a Reopen button
  when `showButtons` (142-151), message fetch via
  `client.channels.fetch(pollData.channel_id)` then `channel.messages.fetch(pollId)`
  (158-163), Discord-first-then-DB update ordering (173-190).
- `src/bot.ts` — per-shard client setup; services are constructed near the
  bottom (`new GuildSyncService(client)` pattern — find it with
  `grep -n "GuildSyncService" src/bot.ts`).
- `src/events/interactionCreate.ts:105-108` — the vote handler already rejects
  votes on `!pollData.active`, so a DB-closed poll stops accepting votes even
  if the Discord message edit failed.
- `src/lib/shardUtils.ts` (from plan 001) — `shardIdForGuild(guildId, shardCount)`.
- `dashboard/src/components/CreatePollModal.tsx` — create form; posts to
  `/api/user/polls`; form state `formData.settings` at lines 64-70.
- Conventions: defer interactions before slow work; on failed vote-count
  queries skip re-render rather than render zeros (see `pollManager.ts:59-67`
  — the scheduler must do the same); `logger` everywhere; i18n via
  `I18n.t(key, locale)` with keys in `src/locales/en.json` + `es-ES.json`.

Differences from `docs/poll-scheduling-plan.md`: we use a plain
`setInterval`, NOT `node-cron` (no new dependency), and the scheduler runs
**on every shard, filtered to its own guilds** (the doc's "only one process"
concern is solved by shard-ownership filtering, which avoids cross-shard
message fetches).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Tests | `npm test` | all pass |
| Lint | `npm run lint` | exit 0 |
| Dashboard | `cd dashboard && npx tsc -b --noEmit && npm run build` | exit 0 |
| Deploy commands (operator runs; changes /poll options) | `npm run deploy` | n/a — note in report |

## Scope

**In scope**:
- `src/lib/durationUtils.ts` (create) + `src/lib/durationUtils.test.ts` (create)
- `src/services/PollSchedulerService.ts` (create)
- `src/lib/pollManager.ts` (add `autoClosePoll`; do NOT restructure `setPollStatus`)
- `src/commands/poll.ts` (duration option + `ends_at` in pollRow)
- `src/bot.ts` (instantiate the scheduler service)
- `src/webapp/pollManagement.ts` (accept/validate `ends_at`)
- `src/webapp/validation.ts` (only if that's where request validation lives — check first)
- `dashboard/src/components/CreatePollModal.tsx` (duration select)
- `dashboard/src/types.ts` (add `ends_at?: string | null` to `Poll`)
- `dashboard/src/pages/UserServerView.tsx` (display "Auto-closes ..." on the card — display only)

**Out of scope**:
- `scheduled_start` / Phase 2 — do not read or write that column.
- DM notifications, countdown-in-image rendering (doc lists them as optional).
- Recurring polls, templates.
- `EditPollModal` — editing `ends_at` after creation is deferred.
- Any schema change.

## Git workflow

- Branch: `feat/poll-auto-close`
- Commit per step; short imperative messages, no AI/agent references.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Duration helper + tests

Create `src/lib/durationUtils.ts`:

```ts
/** Allowed auto-close durations. Key = option value, ms = offset. */
export const POLL_DURATIONS: Record<string, number> = {
    '1h': 3600_000,
    '6h': 6 * 3600_000,
    '12h': 12 * 3600_000,
    '24h': 24 * 3600_000,
    '48h': 48 * 3600_000,
    '7d': 7 * 24 * 3600_000,
};

/** Returns an ISO timestamp now+duration, or null for unknown keys. */
export function endsAtFromDuration(key: string, now: Date = new Date()): string | null {
    const ms = POLL_DURATIONS[key];
    return ms ? new Date(now.getTime() + ms).toISOString() : null;
}

/** Validates a client-supplied ends_at: ISO date, in the future, ≤ 90 days out. */
export function validateEndsAt(value: string, now: Date = new Date()): boolean {
    const t = Date.parse(value);
    if (Number.isNaN(t)) return false;
    return t > now.getTime() && t <= now.getTime() + 90 * 24 * 3600_000;
}
```

Create `src/lib/durationUtils.test.ts` (model on `src/lib/voteUtils.test.ts`):
each duration maps correctly; unknown key → null; `validateEndsAt` rejects
past, non-ISO, and >90-day values; accepts a valid future value.

**Verify**: `npm test` → all pass including the new file.

### Step 2: `PollManager.autoClosePoll`

Add a static method to `src/lib/pollManager.ts` — a non-interactive variant of
the close path. Signature:
`static async autoClosePoll(client: Client, pollData: any): Promise<void>`
(import `Client` from discord.js). Behavior, mirroring `setPollStatus` with
`active=false`:

1. Fetch `guild_settings` (`allow_poll_buttons`, `locale`) for
   `pollData.guild_id` → `showButtons`, `serverLocale` (defaults `true`/`'en'`).
2. `const voteData = await aggregateVotes(pollData.message_id, pollData.options.length);`
   If `voteData.error`: log a warning and **return without closing** — never
   bake a zero-filled image into a closed poll (repo rule; the scheduler will
   retry next tick).
3. Resolve creator tag / mentions and build `renderOptions` exactly as
   `setPollStatus` does (lines 72-103) with `closed: true` and votes always
   shown (`renderOptions.votes = counts` — closed polls always reveal counts,
   see `showVotes = !active || settings.public` at line 87).
4. Components: Reopen button when `showButtons` (copy lines 142-151).
5. Fetch channel + message (`client.channels.fetch(pollData.channel_id)`,
   `channel.messages.fetch(pollData.message_id)`).
6. Edit the message, THEN set `active: false` in the DB (same ordering as
   lines 173-190).
7. Error handling — this is where auto-close must differ from the interactive
   path, or the scheduler will retry a dead poll every minute forever:
   - Discord error `10008` (Unknown Message): set
     `{ active: false, discord_deleted: true }` in the DB, log info.
   - Errors `50001`/`50013` (missing access/permissions): set
     `{ active: false }` anyway and log a warning — the DB close is what stops
     votes (`interactionCreate.ts:105-108`); the stale image is acceptable.
   - Any other error: log and return WITHOUT touching the DB (retry next tick).

Do not refactor `setPollStatus` itself; duplication between the two methods is
accepted for this plan (note it in the PR description).

**Verify**: `npm run typecheck` → exit 0.

### Step 3: `PollSchedulerService`

Create `src/services/PollSchedulerService.ts`:

```ts
import { Client } from 'discord.js';
import { supabase } from '../lib/db';
import { logger } from '../lib/logger';
import { PollManager } from '../lib/pollManager';
import { shardIdForGuild } from '../lib/shardUtils';

const TICK_MS = 60_000;

export class PollSchedulerService {
    private client: Client;
    private running = false;

    constructor(client: Client) {
        this.client = client;
        this.client.once('clientReady', () => {
            const timer = setInterval(() => this.tick(), TICK_MS);
            timer.unref();
            logger.info('[PollScheduler] Started (60s tick).');
        });
    }

    private async tick() {
        if (this.running) return; // don't overlap slow ticks
        this.running = true;
        try {
            const { data: due, error } = await supabase
                .from('polls')
                .select('*')
                .lte('ends_at', new Date().toISOString())
                .eq('active', true)
                .not('ends_at', 'is', null)
                .limit(25);
            if (error || !due) {
                if (error) logger.error('[PollScheduler] Query failed:', error);
                return;
            }
            const shardIds = this.client.shard?.ids ?? [0];
            const shardCount = this.client.shard?.count ?? 1;
            const mine = due.filter(p => shardIds.includes(shardIdForGuild(p.guild_id, shardCount)));

            for (const poll of mine) {
                try {
                    await PollManager.autoClosePoll(this.client, poll);
                    logger.info(`[PollScheduler] Auto-closed poll ${poll.message_id} (guild ${poll.guild_id}).`);
                } catch (err) {
                    logger.error(`[PollScheduler] Failed to auto-close ${poll.message_id}:`, err);
                }
            }
        } finally {
            this.running = false;
        }
    }
}
```

Match the event name used elsewhere in the codebase — `GuildSyncService.ts:14`
uses `Events.ClientReady`; use the same import/constant, not the string above.

Instantiate it in `src/bot.ts` immediately after the existing
`new GuildSyncService(client)` line, same style.

**Verify**: `npm run typecheck && npm run lint` → exit 0.

### Step 4: `/poll` duration option

In `src/commands/poll.ts`:

1. Add after the `allowed_role` option (keep it last):
   ```ts
   .addStringOption(option =>
       option.setName('duration')
           .setDescription('Auto-close the poll after this long (default: never)')
           .setRequired(false)
           .addChoices(
               { name: '1 hour', value: '1h' },
               { name: '6 hours', value: '6h' },
               { name: '12 hours', value: '12h' },
               { name: '24 hours', value: '24h' },
               { name: '48 hours', value: '48h' },
               { name: '7 days', value: '7d' },
           ))
   ```
2. In `execute`, read it: `const duration = interaction.options.getString('duration');`
   and compute `const endsAt = duration ? endsAtFromDuration(duration) : null;`
   (import from `../lib/durationUtils`).
3. Add `ends_at: endsAt,` to the `pollRow` object (lines ~310-326, next to
   `created_at`).

Note in your completion report that the operator must run `npm run deploy` to
register the new option with Discord.

**Verify**: `npm run typecheck` → exit 0.

### Step 5: Dashboard create path

Backend (`src/webapp/pollManagement.ts`):
1. Add `ends_at?: string | null;` to `CreatePollRequest` (lines 481-498).
2. Where the request is validated (check `src/webapp/validation.ts` for the
   `validateCreatePoll`-style function the POST handler calls — follow its
   pattern), validate `body.ends_at` with `validateEndsAt` from
   `durationUtils`; reject with 400 `{ error: 'Invalid ends_at' }` if present
   and invalid.
3. Add `ends_at: body.ends_at ?? null` to the inserted `pollRow` (~line 681).

Frontend (`dashboard/src/components/CreatePollModal.tsx`):
1. Add a "Auto-close" `<select>` to the form (None / 1h / 6h / 12h / 24h /
   48h / 7 days — match the existing form-field styling in the same file).
   Compute `ends_at` client-side at submit time
   (`new Date(Date.now() + ms).toISOString()`), include it in the POST body
   top-level (NOT inside `settings`).
2. `dashboard/src/types.ts`: add `ends_at?: string | null;` to `Poll`.
3. `dashboard/src/pages/UserServerView.tsx`: in the inline poll card header
   area, when `poll.ends_at && poll.active`, render a small badge:
   `Auto-closes {new Date(poll.ends_at).toLocaleString()}` (match the existing
   badge styling used for Active/Closed).

**Verify**: `npm run typecheck` (backend) and
`cd dashboard && npx tsc -b --noEmit && npm run build` → all exit 0.

## Test plan

- `src/lib/durationUtils.test.ts` — as Step 1 (≥ 6 cases).
- Manual, in the `DEV_ONLY_MODE`/`DEV_GUILD_ID` test guild only (never
  production): create `/poll duration:1 hour`; confirm the DB row has
  `ends_at` ≈ now+1h; temporarily update the row's `ends_at` to the past in
  the dev DB; within ~60s the poll message re-renders closed with a Reopen
  button and `active=false`. Repeat once via the dashboard create form.
- Failure path: delete the Discord message, set `ends_at` past → poll ends up
  `active=false, discord_deleted=true` without scheduler error-looping.
- `npm test` → all pass.

## Done criteria

- [ ] `npm run typecheck`, `npm test`, `npm run lint` all exit 0
- [ ] `cd dashboard && npx tsc -b --noEmit && npm run build` exits 0
- [ ] `grep -n "scheduled_start" src/services/PollSchedulerService.ts` → no matches (Phase 2 not smuggled in)
- [ ] `grep -rn "ends_at" src/commands/poll.ts src/webapp/pollManagement.ts` → ≥ 1 match each
- [ ] `src/lib/durationUtils.test.ts` exists and passes
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated; completion report notes the `npm run deploy` requirement

## STOP conditions

Stop and report back if:

- `polls.ends_at` does not exist in the live dev database (migration 11 was
  never applied) — the operator must apply it first.
- `src/lib/shardUtils.ts` exists but with a different signature than plan 001
  Step 2 specifies.
- `setPollStatus`'s structure differs materially from the excerpts (drift) —
  `autoClosePoll` is defined as its mirror, so drift there invalidates Step 2.
- The `/poll` command already has 25 options (Discord's cap) — count before adding.
- The dashboard POST validation lives somewhere other than
  `pollManagement.ts`/`validation.ts` and you cannot find it within 15 minutes.

## Maintenance notes

- The scheduler tick LIMITs to 25 polls per minute per query; a huge backlog
  (e.g. after extended downtime) drains at 25/min — acceptable, but a reviewer
  should know it's deliberate.
- `autoClosePoll` duplicates render/component logic from `setPollStatus`;
  when someone next touches the close flow, extracting a shared
  `buildClosedPollMessage` is the right refactor (deferred to keep this
  change additive).
- Phase 2 (`scheduled_start`) can reuse `PollSchedulerService.tick` with a
  second query — the service was named generically for that reason.
- If plan 001's reconcile marks a guild left while it still has scheduled
  polls, the scheduler will fail channel fetches for those polls; the 10008 /
  permission handling covers it.
