# PollBot

PollBot is an image-generating Discord polling bot built with TypeScript,
discord.js, and Playwright. Instead of text embeds, every poll is rendered as a
PNG by a headless-Chromium render service, with live vote counts, weighted
voting, scheduled auto-close, localization, and a full web dashboard backed by
Supabase (Postgres).

## Features

- Image-based polls: every poll and results view is rendered as a high-quality
  image, updated live as votes come in (renders are coalesced per poll to stay
  inside Discord rate limits).
- Flexible voting: single- and multi-select (`min_votes` / `max_votes`),
  role-restricted voting, and per-role vote weights configured globally
  (`/config weights`) or per poll.
- Scheduled auto-close: give a poll a duration (1 hour to 7 days) and a
  DB-backed scheduler closes it on time, surviving restarts. Closes render the
  final results and offer a Reopen button.
- Web dashboard: server managers create, edit, duplicate, close, and export
  polls in the browser; voters get a cross-server "My Votes" history. Admins
  get global analytics (voting trends, peak hours, usage by surface, most
  active servers).
- Premium (Top.gg): voter breakdowns and per-server vote analytics unlock by
  voting for the bot on Top.gg.
- Exports: poll results as CSV, from the `/export-poll` command, right-click
  context menus, or the dashboard.
- Internationalization: locale configurable per server (`/config locale`);
  English and Spanish ship today.
- Usage telemetry: bot-vs-dashboard usage recorded in an aggregate-only events
  table and charted for admins.

## Architecture

| Piece | Where | What it does |
|-------|-------|--------------|
| Manager | `src/index.ts` | Verifies DB connectivity, then spawns Discord shards, the web server, and background services |
| Shard client | `src/bot.ts` | Per-shard discord.js client; caches are capped to bound memory |
| Web server | `src/webhook.ts`, `src/webapp/` | Express API for the dashboard (Discord OAuth sessions, CSRF), Top.gg vote webhook, cloudflared tunnels |
| Render service | `src/services/renderService.ts` | HTTP service rendering poll images via a pooled headless Chromium (Playwright) |
| Scheduler | `src/services/PollSchedulerService.ts` | Closes polls whose `ends_at` has passed (60-second tick, per-shard ownership) |
| Dashboard | `dashboard/` | React 19 + Vite + Tailwind SPA served by the bot and talking to `/api` |
| Database | `schema.sql`, `supabase/migrations/` | Supabase Postgres: tables, RLS policies, and aggregate RPC functions |

## Commands

| Command | Description |
|---------|-------------|
| `/poll` | Create a poll (see options below) |
| `/view` | Detailed results and voter breakdown (premium: unlocked by voting on Top.gg) |
| `/export-poll` | Export a poll's votes as CSV |
| `/close`, `/reopen` | Close or reopen a poll by message ID |
| `/config` | Server settings: `poll-buttons`, `locale`, `weights (set/remove/view/clear)` |
| `/stats` | Bot statistics image |
| `/pollmanager` | Manage the Poll Manager role |

Right-click context-menu commands: "View Data" and "Export Results" on any poll
message.

### /poll options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `title` | String | Yes | - | Poll title (max 256 chars) |
| `items` | String | Yes | - | Comma-separated options, max 25 (e.g. "Yes, No, Maybe") |
| `description` | String | No | - | Additional context; user/role mentions are rendered in the image |
| `max_votes` | Integer | No | 1 | Maximum selections per user |
| `min_votes` | Integer | No | 1 | Minimum selections per user |
| `public` | Boolean | No | true | If false, counts stay hidden until the poll closes |
| `thread` | Boolean | No | false | Auto-create a discussion thread |
| `allowed_role` | Role | No | - | Restrict voting to one role |
| `close_button` | Boolean | No | true | Add a Close Poll button (subject to `/config poll-buttons`) |
| `allow_exports` | Boolean | No | true | Allow members to export this poll's results |
| `duration` | Choice | No | - | Auto-close after 1h, 6h, 12h, 24h, 48h, or 7 days |

## Getting started

### Prerequisites

- Node.js 20 or newer (CI runs 22)
- A Supabase project (or a local Supabase stack for development)
- A Discord application with a bot token

### Setup

1. Install dependencies (the postinstall step downloads the Chromium build
   used for rendering and compiles the backend):

   ```bash
   npm install
   cd dashboard && npm install && cd ..
   ```

2. Configure the environment:

   ```bash
   cp .env.example .env            # backend — see comments in the file
   cp dashboard/.env.example dashboard/.env   # dashboard build-time vars
   ```

   The important backend variables: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`,
   `SUPABASE_URL`, `SUPABASE_KEY` (service_role key — keep secret), and for
   the dashboard login `DISCORD_CLIENT_SECRET`, `DISCORD_OAUTH_REDIRECT_URI`,
   `DISCORD_ADMIN_IDS`. Optional integrations: Top.gg (`TOPGG_TOKEN`,
   `TOPGG_WEBHOOK_AUTH`) and cloudflared tunnel tokens.

3. Set up the database: run `schema.sql` in the Supabase SQL editor on a fresh
   project. On an existing database, apply the numbered files in
   `supabase/migrations/` you have not run yet, in order.

4. Register slash commands:

   ```bash
   npm run deploy
   ```

   With `DEV_ONLY_MODE=true` and `DEV_GUILD_ID` set, commands register only in
   your test server (instant, and safe to iterate on); otherwise they register
   globally.

5. Run:

   ```bash
   npm run dev      # development (ts-node)

   npm run build    # production
   npm start
   ```

   The dashboard is served by the bot itself from `dashboard/dist`, so build
   it once (`cd dashboard && npm run build`) or use the Vite dev server for
   hot reload (`cd dashboard && npm run dev`).

## Development

```bash
npm run typecheck   # tsc --noEmit (backend)
npm test            # vitest unit tests
npm run lint        # ESLint (advisory)
npm run build       # compile + copy locales into dist/
cd dashboard && npx tsc -b --noEmit && npm run build   # dashboard gates
```

CI runs the backend typecheck and tests plus the dashboard typecheck and build
on every pull request.

Always test against a dev bot and test guild (`DEV_ONLY_MODE=true`), never
against production.

### Database changes

`schema.sql` is the canonical schema. Every change ships as a new numbered
file in `supabase/migrations/` and is mirrored into `schema.sql`; migrations
are applied manually in the Supabase SQL editor (this project does not use the
Supabase CLI migration history). RPC functions that read `users` or `votes`
must `REVOKE ALL ... FROM PUBLIC` and grant only the roles that need them —
the dashboard's anon key may only ever reach aggregate results.

## Deployment

The production instance runs as a systemd service on Linux. A deploy is:

```bash
git pull
npm ci && npm run build
cd dashboard && npm ci && npm run build && cd ..
npm run deploy      # only when slash commands changed
# restart the service
```

Set `NODE_ENV=production` so the session cookie is marked Secure. The
dashboard and Top.gg webhook are exposed through cloudflared tunnels
configured by the `*_CLOUDFLARED_TOKEN` variables.

## License

MIT
