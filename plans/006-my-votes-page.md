# Plan 006: "My Votes" — cross-server list of polls the user voted in

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e720b35..HEAD -- src/webapp/userPolls.ts dashboard/src/App.tsx dashboard/src/pages docs/future-features.md`
> Compare "Current state" excerpts on changed files; mismatch = STOP.
> Changes from plans 003/004 in dashboard files are expected drift, not a STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (purely additive: one read-only endpoint + one page)
- **Depends on**: none strictly; if plan 004 has landed, use its `ui/` primitives (EmptyState, Skeleton) instead of hand-rolling states.
- **Category**: direction (feature)
- **Planned at**: commit `e720b35`, 2026-07-09

## Why this matters

`docs/future-features.md:7-47` specifies this feature end-to-end (endpoint
`GET /api/user/votes`, page `/my-votes`, the SQL join), and migration
`16_votes_user_index.sql` added `idx_votes_user_id` **specifically for it** —
the index is paying write cost with no consumer. Product-wise it gives every
voter (not just server admins) a reason to log into the dashboard.

## Current state

- `docs/future-features.md:7-47` — the spec. Read it first. Key points: votes
  joined to polls and guilds, paginated, authenticated, and (due to the FK
  chain) only votes whose poll still exists are returnable.
- Schema (`schema.sql`): `votes(poll_id → polls.message_id ON DELETE CASCADE,
  user_id, option_index, created_at, weight)` — note the composite PK means a
  user can have multiple rows per poll (multi-select). `polls(message_id,
  guild_id → guilds.id, title, options JSONB, active, created_at)`.
  `guilds(id, name, icon_url)`.
- `src/webapp/userPolls.ts` — the router to extend. Auth pattern to copy
  (verbatim conventions, from `router.get('/polls/:guildId', ...)` at lines
  303-333):
  ```ts
  const cookieSession = req.cookies?.[COOKIE_NAME];
  const authHeader = req.headers.authorization;
  const headerSession = authHeader?.replace('Bearer ', '');
  const sessionId = cookieSession || headerSession;
  if (!sessionId) return res.status(401).json({ error: 'Unauthorized' });
  // then validate against dashboard_sessions and expires_at
  ```
  There is also a `getSession(req)` helper at line 110 returning
  `{ user_id, access_token } | null` — use it; it already checks expiry.
  **No guild-permission check is needed here** (unlike the excerpt's
  Manage-Server check): the user reads only their own votes.
- The backend supabase client uses the service key (bypasses RLS), so the
  join works without policy changes. Per CLAUDE.md, `users`/`votes` data for
  the dashboard must flow through the authenticated API — which this is. Do
  NOT implement this with the anon key client-side.
- Router mounting: `src/webhook.ts:45-46` mounts `userPollsRouter` at
  `/api/user` — so a route `router.get('/votes', ...)` is reachable at
  `GET /api/user/votes`. **Route-order hazard**: `router.get('/polls/:guildId')`
  and friends are prefix-distinct from `/votes`, so ordering is safe.
- Dashboard routing — `dashboard/src/App.tsx:115-163`: routes are declared in
  `AppRoutes` with lazy imports (see the `Home` pattern at line 10) and
  wrapped in `<ProtectedRoute>` (non-admin variant, like `/manage/:guildId` at
  lines 153-160).
- Page exemplar: `dashboard/src/pages/PollsView.tsx` — a paginated list page
  fetching + rendering cards, with `FilterButton`s. Match its structure and
  styling (`glass-panel`, `container-wide`).
- Fetch helper: `dashboard/src/utils/api.ts` exports `apiFetch` (adds
  credentials + CSRF); use it for the GET.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Backend typecheck | `npm run typecheck` | exit 0 |
| Backend tests | `npm test` | all pass |
| Dashboard | `cd dashboard && npx tsc -b --noEmit && npm run build` | exit 0 |

## Scope

**In scope**:
- `src/webapp/userPolls.ts` — add `GET /votes` route
- `dashboard/src/pages/MyVotesView.tsx` (create)
- `dashboard/src/App.tsx` — route `/my-votes`
- `dashboard/src/pages/Home.tsx` — one nav link to `/my-votes` (place beside
  the existing nav buttons in the user section; keep it visible for admins too)
- `dashboard/src/types.ts` — `MyVote` interface

**Out of scope**:
- Any schema/migration change (the index exists).
- Deep-linking to the Discord message (`https://discord.com/channels/...` is a
  nice-to-have; include it only if trivial — the data has guild_id/channel_id/message_id).
- Vote deletion/editing from this page.
- Grouping by server (spec mentions it as an option; ship chronological first).

## Git workflow

- Branch: `feat/my-votes`
- Commit per step; short imperative messages, no AI/agent references.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Backend endpoint

In `src/webapp/userPolls.ts`, add `GET /votes` (place it near the other
`router.get` routes, after the helpers):

1. Auth via `getSession(req)`; 401 on null.
2. Query params: `limit` (default 25, max 100), `offset` (default 0) — parse
   with `parseInt`, clamp, reject NaN with 400.
3. Query — one round trip using PostgREST embedded resources:
   ```ts
   const { data, error, count } = await supabase
       .from('votes')
       .select('poll_id, option_index, weight, created_at, polls!inner(message_id, title, guild_id, channel_id, active, options, guilds!inner(name, icon_url))', { count: 'exact' })
       .eq('user_id', session.user_id)
       .order('created_at', { ascending: false })
       .range(offset, offset + limit - 1);
   ```
4. Post-process: group rows by `poll_id` (multi-select polls produce one row
   per chosen option) into
   `{ poll_id, title, guild_name, guild_icon_url, guild_id, channel_id, active, chosen_options: string[], weight, voted_at }`
   where `chosen_options` maps each `option_index` into the poll's `options`
   array (guard out-of-range indices with a fallback like `Option N+1`).
   Note: grouping AFTER `range()` means `limit` counts vote rows, not polls —
   acceptable; document it in the response (`limit` semantics) rather than
   fighting PostgREST.
5. Respond `{ votes: grouped, total: count, limit, offset }`. On query error:
   log via `logger.error('[UserPolls] ...')` and return 500
   `{ error: 'Failed to fetch votes' }` — match the file's existing error style.

**Verify**: `npm run typecheck` → exit 0. Optional live check if a dev stack
is running: `curl -H "Authorization: Bearer <dev session id>" http://localhost:5000/api/user/votes` → 200 JSON.

### Step 2: Types + page

1. `dashboard/src/types.ts` — add:
   ```ts
   export interface MyVote {
       poll_id: string;
       title: string;
       guild_id: string;
       guild_name: string;
       guild_icon_url: string | null;
       channel_id: string;
       active: boolean;
       chosen_options: string[];
       weight: number;
       voted_at: string;
   }
   ```
2. Create `dashboard/src/pages/MyVotesView.tsx` modeled structurally on
   `PollsView.tsx`: header ("My Votes"), chronological list of `glass-panel`
   rows — guild icon + name, poll title, chosen option(s), weight badge when
   `weight > 1`, `Active`/`Closed` pill (copy the pill from
   `PollCard.tsx:32-34`), `voted_at` via `toLocaleString()`. "Load more"
   button using `offset` (simpler than numbered pages). Loading and empty
   states: use `ui/Skeleton` + `ui/EmptyState` if plan 004 landed, else copy
   the skeleton pattern from `Home.tsx` (`SkeletonCard`) and the rich empty
   state pattern (`Home.tsx:787` area). Fetch with
   `apiFetch(\`/api/user/votes?limit=25&offset=${offset}\`)`.

**Verify**: `cd dashboard && npx tsc -b --noEmit` → exit 0.

### Step 3: Route + nav link

1. `dashboard/src/App.tsx`: lazy-import like line 10-14 pattern
   (`const MyVotesView = lazy(...)`), and add inside `<Routes>`:
   ```tsx
   <Route path="/my-votes" element={<ProtectedRoute><MyVotesView /></ProtectedRoute>} />
   ```
   (NOT `adminOnly` — this is for every user.)
2. `dashboard/src/pages/Home.tsx`: add a "My Votes" nav button
   (`onClick={() => navigate('/my-votes')}`) styled like the existing nav
   buttons at lines 501-502, in the section rendered for all users (make sure
   it isn't inside the admin-only block — trace which JSX branch renders for
   non-admins before placing it).

**Verify**: `cd dashboard && npx tsc -b --noEmit && npm run build` → exit 0.

## Test plan

- No backend test harness covers Express routes today (vitest is unit-only);
  add `src/webapp/userPolls.votes.test.ts` ONLY for the pure grouping helper —
  extract the group-by-poll logic into an exported pure function
  (`groupVoteRows(rows): MyVote[]`) and unit-test: single-option vote,
  multi-select grouping, out-of-range option index fallback, empty input.
  Model on `src/lib/voteUtils.test.ts`.
- Manual (dev stack): log in as a user with votes in ≥ 2 dev guilds → rows
  appear newest-first; a multi-select vote renders as one row with N options;
  empty account shows the empty state.

## Done criteria

- [ ] `npm run typecheck`, `npm test` exit 0; grouping tests exist and pass
- [ ] `cd dashboard && npx tsc -b --noEmit && npm run build` exits 0
- [ ] `grep -n "'/votes'" src/webapp/userPolls.ts` → 1 match
- [ ] `grep -n "my-votes" dashboard/src/App.tsx` → 1 match
- [ ] Endpoint enforces auth (code path returns 401 without a session)
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The PostgREST embedded select in Step 1 fails against the dev DB (FK naming
  can break embedding) — report the error; do NOT fall back to fetching whole
  tables client-side or issuing per-vote queries.
- `getSession` at `userPolls.ts:110` has changed signature (drift).
- You cannot determine where non-admin nav lives in `Home.tsx` — placing the
  link in an admin-only branch would hide the feature from its audience.

## Maintenance notes

- The FK `votes.poll_id → polls.message_id ON DELETE CASCADE` means deleted
  polls silently vanish from this list — that's the documented behavior
  (`future-features.md:42`), not a bug.
- If polls gain server-side deletion of old data (retention), this page's
  "total" count shrinks accordingly.
- Deferred: group-by-server view, Discord deep links, filters (active/closed).
