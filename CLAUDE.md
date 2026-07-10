# CLAUDE.md — PollBot

Guidance for AI agents (and humans) working in this repository.

## What this is

An image-generating Discord poll bot. A sharded discord.js bot renders polls as
PNG images (via a headless Chromium / Playwright render service), stores state in
Supabase (Postgres), and exposes a React dashboard for managing polls, viewing
voters, and exporting results.

## Architecture

- **`src/index.ts`** — the **manager** process. Verifies the DB is reachable
  (exponential backoff) then spawns discord.js shards, the Express web/API
  server, and background services. Barely touches the DB itself.
- **`src/bot.ts`** — the per-**shard** client (`ExtendedClient`). discord.js
  caches are capped here (message/reaction caching disabled, message partials on)
  to bound memory; the `messageDelete` handler relies on partials.
- **`src/webhook.ts`** — Express app: mounts the dashboard API routers, the
  Top.gg `/vote` webhook, the admin `/api/admin/sync-guilds` endpoint, and starts
  the cloudflared tunnels. Holds the `ShardingManager` reference so API routes can
  `broadcastEval` / `shard.send` to shards.
- **`src/webapp/`** — Express API: `dashboardAuth.ts` (Discord OAuth + httpOnly
  cookie sessions), `csrf.ts`, `validation.ts`, `pollManagement.ts` (poll CRUD),
  `userPolls.ts`, `userGuilds.ts`.
- **`src/lib/`** — shared logic: `db.ts` (Supabase client + connection checks),
  `voteUtils.ts` (**the single source of truth for vote counting** — always use
  it), `pollManager.ts` (`PollManager` poll-state class), `renderer.ts` /
  `renderBackend.ts` / `browserPool.ts` (rendering), `i18n.ts`, `logger.ts`,
  `guildUtils.ts`, `renderQueue.ts` (per-poll render coalescing).
- **`src/services/`** — `renderService.ts` (HTTP render server), background
  services (`GuildSyncService`, `DashboardService`, `TelemetryTunnelService`).
- **`dashboard/`** — separate React 19 + Vite + Tailwind SPA. Talks to the API
  through the `/api` proxy and (for some reads) directly to Supabase with the
  anon key.
- **`schema.sql`** — full DB schema (tables, RLS policies, RPC functions). The
  canonical source; `supabase/migrations/*.sql` are numbered, **manually-applied**
  incremental changes (run them in the Supabase SQL editor — this project does
  not use the Supabase CLI migration history).

Two files share the name `pollManager.ts` (`src/commands/pollManager.ts` is the
`/pollmanager` role command; `src/lib/pollManager.ts` is the `PollManager`
poll-state class). They are unrelated — mind which one you edit.

## Commands (must all pass before a change is done)

- `npm run typecheck` — `tsc --noEmit` (backend). No new errors.
- `npm test` — vitest unit tests (`src/**/*.test.ts`).
- `npm run lint` — ESLint (advisory; warnings allowed).
- `npm run build` — `tsc` + copy locales into `dist/` (cross-platform Node copy).
- Dashboard: `cd dashboard && npx tsc -b --noEmit && npm run build`.

CI (`.github/workflows/ci.yml`) runs typecheck + test for the backend and
typecheck + build for the dashboard on every PR.

## Conventions

- TypeScript, 4-space indent. `any` is tolerated at Discord/Supabase boundaries.
- **Vote counting**: never hand-roll aggregation. Call `aggregateVotes()` /
  `aggregateVoteRows()` from `src/lib/voteUtils.ts`; weighted counts must stay
  consistent across live voting, close/reopen, `/view`, dashboard, and export.
- **Discord interactions**: defer (`deferReply`) before any slow DB/render work —
  Discord requires acknowledgement within 3 seconds.
- **DB error handling**: on a failed vote-count query, skip re-rendering the poll
  image rather than displaying a zero-filled fallback.
- **Migrations**: add a new numbered file in `supabase/migrations/` AND mirror the
  change into `schema.sql`. RPC functions that read `users`/`votes` must
  `REVOKE ALL ... FROM PUBLIC` and grant only the roles that need them.

## Deployment

Runs as a systemd service (`pollbot.service`) on a Linux host; the dashboard and
Top.gg webhook are exposed via cloudflared tunnels. `npm run build` then
`npm start`. Set `NODE_ENV=production` so the session cookie is marked Secure.

## Do not

- Test against production. There is a `DEV_ONLY_MODE` + `DEV_GUILD_ID` path for a
  scoped test guild — use it.
- Read `users`/`votes` from the dashboard with the anon key for new features;
  route through the authenticated API or a SECURITY DEFINER aggregate RPC.
