# Plan 008: Premium Vote Analytics — give the premium gate a second feature

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e720b35..HEAD -- src/webapp/userPolls.ts dashboard/src/components/PremiumGateModal.tsx dashboard/src/pages/UserServerView.tsx schema.sql supabase/migrations`
> Compare "Current state" excerpts on changed files; mismatch = STOP. Changes
> from plans 001/004/007 are expected drift.

## Status

- **Priority**: P3
- **Effort**: M-L
- **Risk**: MED (touches the premium gate; queries over the largest table)
- **Depends on**: none (migration numbering: next free number after 001/007)
- **Category**: direction (feature)
- **Planned at**: commit `e720b35`, 2026-07-09

## Why this matters

A full premium stack exists — Top.gg `/vote` webhook granting 12-13h of
premium (`src/webhook.ts:117-141`), `checkPremiumStatus()` and premium
endpoints (`src/webapp/userPolls.ts:133-155`, `/premium/status` at line 707),
and a `PremiumGateModal` — but it gates exactly **one** feature: the per-option
voter breakdown. `docs/future-features.md:56-73` already names the next gate:
**Vote Analytics** (most active voters, peak voting times, vote distribution
over time), and notes the schema supports it via `votes.created_at`,
`polls.guild_id`, `votes.user_id`. Chart infrastructure exists
(`dashboard/src/components/charts/`). More premium surface strengthens the
vote-on-Top.gg growth loop.

## Current state

- Premium check — `src/webapp/userPolls.ts:133-155`:
  ```ts
  async function checkPremiumStatus(userId: string): Promise<{ isPremium: boolean; expiresAt?: string }> {
      // users.last_vote_at within PREMIUM_HOURS (13h) → premium
  ```
- The existing premium-gated endpoint is `GET /polls/:pollId/voters`
  (`userPolls.ts:463`). **Before writing any code, read that whole handler**
  (lines ~463-560): it is the pattern for session auth, guild permission
  check, the premium 403 (match its exact error body so the frontend
  detection keeps working), and Discord member enrichment via
  `fetchVoterData` (line 163).
- Auth/permission pattern for guild-scoped routes: `router.get('/polls/:guildId')`
  at `userPolls.ts:303-360` (session → `dashboard_sessions`, then Manage
  Server check with per-user permission cache).
- `dashboard/src/components/PremiumGateModal.tsx` — hardcodes the copy to the
  voter-breakdown feature (line ~87). It must gain a `featureName`/`description`
  prop with defaults preserving current usage.
- `dashboard/src/pages/UserServerView.tsx` — the per-server management page
  (1034 lines); its premium flow for voters: the inline PollCard fetches
  `/voters` and opens `PremiumGateModal` on the premium-403. Search for
  `PremiumGateModal` usage there before wiring the new panel.
- RPC conventions — `schema.sql:246-276`: aggregates over `users`/`votes` are
  `SECURITY DEFINER` with `REVOKE ALL ... FROM PUBLIC`; grants: anon gets only
  counts-without-identifiers. **Top-voters returns user_ids, so its RPC must
  be granted to `service_role` ONLY** and consumed via the authenticated API —
  this is the CLAUDE.md rule ("route through the authenticated API or a
  SECURITY DEFINER aggregate RPC"; dashboard anon reads of `users`/`votes` are
  forbidden for new features).
- Chart exemplar: `dashboard/src/components/charts/VoteHistoryChart.tsx`.
- `docs/future-features.md:70-73` flags the considerations this plan must
  honor: query performance on large datasets, privacy of voting patterns,
  premium gating.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Backend | `npm run typecheck && npm test && npm run lint` | exit 0 / all pass |
| Dashboard | `cd dashboard && npx tsc -b --noEmit && npm run build` | exit 0 |

## Scope

**In scope**:
- `supabase/migrations/NN_guild_analytics_rpcs.sql` (create; next free number) + `schema.sql` mirror
- `src/webapp/userPolls.ts` — one new route `GET /guilds/:guildId/analytics`
- `dashboard/src/components/PremiumGateModal.tsx` — parameterize copy
- `dashboard/src/components/charts/GuildAnalyticsPanel.tsx` (create)
- `dashboard/src/pages/UserServerView.tsx` — mount the panel + gate flow
- `dashboard/src/types.ts` — response types

**Out of scope**:
- Changing what premium *is* (the 13h Top.gg window). No `tier` column, no
  durable entitlements — that's a product decision this plan must not make.
- Global (cross-guild) analytics; admin analytics. This is per-guild, for
  server managers.
- Exposing per-user voting *content* (which option someone chose) — top voters
  shows volume only.

## Git workflow

- Branch: `feat/premium-vote-analytics`
- Commit per step; short imperative messages, no AI/agent references.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Analytics RPCs

New migration (next free `NN_`), mirrored into `schema.sql`. Three functions,
all `SECURITY DEFINER`, all `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ...
TO service_role` **only**:

```sql
-- Votes per day for a guild (counts only).
CREATE OR REPLACE FUNCTION get_guild_vote_activity(p_guild_id TEXT, p_days INT DEFAULT 30)
RETURNS TABLE(day DATE, votes BIGINT, unique_voters BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
    SELECT v.created_at::DATE, COUNT(*)::BIGINT, COUNT(DISTINCT v.user_id)::BIGINT
    FROM votes v JOIN polls p ON v.poll_id = p.message_id
    WHERE p.guild_id = p_guild_id
      AND v.created_at > NOW() - make_interval(days => LEAST(GREATEST(p_days, 1), 365))
    GROUP BY 1 ORDER BY 1;
$$;

-- Vote volume by hour-of-day (UTC) — "peak voting times".
CREATE OR REPLACE FUNCTION get_guild_peak_hours(p_guild_id TEXT, p_days INT DEFAULT 30)
RETURNS TABLE(hour INT, votes BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
    SELECT EXTRACT(HOUR FROM v.created_at)::INT, COUNT(*)::BIGINT
    FROM votes v JOIN polls p ON v.poll_id = p.message_id
    WHERE p.guild_id = p_guild_id
      AND v.created_at > NOW() - make_interval(days => LEAST(GREATEST(p_days, 1), 365))
    GROUP BY 1 ORDER BY 1;
$$;

-- Most active voters (ids + counts; the API enriches names). service_role ONLY.
CREATE OR REPLACE FUNCTION get_guild_top_voters(p_guild_id TEXT, p_days INT DEFAULT 30, p_limit INT DEFAULT 10)
RETURNS TABLE(user_id TEXT, votes BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
    SELECT v.user_id, COUNT(*)::BIGINT
    FROM votes v JOIN polls p ON v.poll_id = p.message_id
    WHERE p.guild_id = p_guild_id
      AND v.created_at > NOW() - make_interval(days => LEAST(GREATEST(p_days, 1), 365))
    GROUP BY 1 ORDER BY 2 DESC LIMIT LEAST(GREATEST(p_limit, 1), 25);
$$;
```

Add the REVOKE/GRANT pairs for each (see `schema.sql:243-244` for the format).
Performance note: these scan `votes` filtered through `idx_polls_guild_id` +
`idx_votes_poll_id`; acceptable at current scale, revisit with a
`votes(created_at)` index if slow (do NOT add that index speculatively).

**Verify**: migration + `grep -c "get_guild_vote_activity\|get_guild_peak_hours\|get_guild_top_voters" schema.sql` → 6+ (defs + grants).

### Step 2: Authenticated, premium-gated endpoint

In `src/webapp/userPolls.ts`, add `GET /guilds/:guildId/analytics`
(reached as `/api/user/guilds/:guildId/analytics`):

1. Session auth + Manage Server permission check — copy the structure of
   `GET /polls/:guildId` (lines 303-360) including the permission cache use.
2. Premium gate — call `checkPremiumStatus(session.user_id)`; on
   `!isPremium`, return the **same status and body shape** the `/voters`
   endpoint uses for its premium rejection (read that handler and match
   exactly).
3. Fetch the three RPCs in parallel
   (`Promise.all([supabase.rpc('get_guild_vote_activity', {...}), ...])`);
   `days` query param (default 30, clamp 1-365).
4. Enrich top-voter ids with Discord usernames the way `fetchVoterData`
   (line 163) does its member enrichment — reuse its member-cache helper if
   exported, otherwise fall back to returning ids with a `username: null`
   the frontend renders as `User 1234…`. Do not add a new Discord API call
   pattern.
5. Respond `{ activity: [...], peakHours: [...], topVoters: [...], days }`.

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Parameterize `PremiumGateModal`

Add optional props `featureName?: string` and `description?: string` with
defaults equal to the current hardcoded voter-breakdown copy (so existing call
sites need no change). Replace the hardcoded strings with the props.

**Verify**: `cd dashboard && npx tsc -b --noEmit` → exit 0; existing usages unchanged (`git diff` shows only the modal file for this step).

### Step 4: Analytics panel in `UserServerView`

Create `dashboard/src/components/charts/GuildAnalyticsPanel.tsx`:
self-contained (fetches `/api/user/guilds/${guildId}/analytics?days=30` via
`apiFetch` from `utils/api.ts`), renders three visualizations styled like the
existing charts: activity area chart (model: `VoteHistoryChart`), peak-hours
bar chart, top-voters list (reuse `Leaderboard.tsx` if its props fit).
States: loading skeleton, empty ("No votes in this period"), and — on the
premium-403 — an inline locked-state card with an "Unlock with a vote" button
that opens `PremiumGateModal` with
`featureName="Vote Analytics"`.

Mount it in `UserServerView.tsx` below the polls list (find the main content
column; add a collapsible "Analytics" section header matching the page's
heading style). Fetch lazily — only when the section is expanded — so
non-premium users don't pay the request on page load.

**Verify**: `cd dashboard && npx tsc -b --noEmit && npm run build` → exit 0.

## Test plan

- No route-level test harness exists; unit-test any pure helper you extract
  (e.g. clamping/parsing of `days`) in `src/webapp/*.test.ts` following
  `src/lib/voteUtils.test.ts`.
- Manual (dev stack + dev guild, migration applied): as a premium user
  (set your dev user's `users.last_vote_at = NOW()` in the dev DB), expand
  Analytics → three charts render with dev data. As non-premium
  (`last_vote_at = NULL`) → locked card + gate modal, no data leaked in the
  network response.
- Verify the voter-breakdown premium flow still works (modal defaults intact).

## Done criteria

- [ ] `npm run typecheck && npm test && npm run lint` exit 0
- [ ] `cd dashboard && npx tsc -b --noEmit && npm run build` exits 0
- [ ] All three RPCs have `REVOKE ALL ... FROM PUBLIC` + `GRANT ... TO service_role` (and NOT anon) in both migration and `schema.sql`
- [ ] `grep -n "get_guild_top_voters" dashboard/src` → no matches (no anon-key RPC calls from the client)
- [ ] Premium 403 body matches the `/voters` endpoint's shape
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated; report notes the manual migration

## STOP conditions

Stop and report back if:

- The `/voters` handler's premium rejection doesn't have a clearly matchable
  shape (drift) — the frontend gate detection depends on it.
- `fetchVoterData`'s member-enrichment helper can't be reused without
  exporting significant internals — return ids un-enriched and report, rather
  than duplicating the Discord member-cache logic.
- `UserServerView.tsx` has been decomposed by another plan and the mount
  point is ambiguous.
- Anyone asks you to expose these RPCs to the anon key "to simplify" — that
  violates the repo's stated security rule.

## Maintenance notes

- Privacy: top-voters exposes *who votes most* to server managers (not what
  they voted). `docs/future-features.md:72` flagged this consideration; the
  volume-only design is the mitigation. A reviewer should confirm no endpoint
  path returns option-level per-user data outside the existing voter breakdown.
- If premium ever becomes a durable paid tier, `checkPremiumStatus` is the
  single choke point to swap.
- Query cost grows with `votes`; if analytics gets slow, add
  `CREATE INDEX ... ON votes(created_at)` via a new migration and re-test.
