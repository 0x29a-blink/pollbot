<div align="center">

# PollBot

### Polls your server will actually vote on.

PollBot renders every poll as a crisp, live-updating image — not a wall of embed
text. Multi-select, weighted votes, private results, role-gated voting,
scheduled auto-close, and a full web dashboard. One command and you're live.

[**Add to Discord**](https://discord.com/api/oauth2/authorize?client_id=911731627498041374&permissions=534992383040&scope=applications.commands%20bot) ·
[**Dashboard**](https://pollbot.win) ·
[**Vote on Top.gg**](https://top.gg/bot/911731627498041374) ·
[**Support**](https://discord.gg/MYRqdNFQfk)

</div>

---

![Poll Example](https://i.imgur.com/hkZatLO.png)

*`/poll title: Which feature did you like more? items: Feature 1, Feature 2, Feature 3 max_votes: 2` —
that's the whole setup. The image redraws itself as votes land.*

## Everything Discord's built-in polls can't do

- **Image-rendered results.** Polls are drawn as polished images and redrawn
  live with every vote — no plain-text embeds.
- **Real multi-select.** Up to 25 options with min/max picks per voter —
  "choose exactly 3" is one flag away.
- **Weighted voting.** Give @Boosters 3 votes and @Members 1. Weights apply
  everywhere, exports included.
- **Private until close.** Hide running counts so nobody bandwagons — results
  reveal when the poll closes.
- **Auto-close on schedule.** Set a duration from 1 hour to 7 days and the poll
  closes itself, on time, even through restarts.
- **Threads and discussion.** Auto-attach a thread to any poll so the debate
  stays next to the vote.
- **Delegated control.** A dedicated Poll Manager role lets trusted members run
  polls without admin permissions.
- **Speaks your language.** Per-server locale via `/config locale` — English
  and Spanish today.

## Run everything from the browser

The dashboard at [pollbot.win](https://pollbot.win) gives server managers and
voters a home:

- Live results and full voter lists
- Create, edit, duplicate, close, and reopen polls remotely
- One-click CSV export of any poll
- "My Votes" — your voting history across every server
- Vote analytics: activity trends, peak hours, and top voters per server
  (premium — unlocked by voting for the bot on Top.gg)

## Live in under ten seconds

1. **Create** — `/poll title: Movie night items: Dune, Horror, Superhero` and
   you're done.
2. **Vote** — members pick from the menu under the poll; the image redraws with
   every vote.
3. **Close and export** — close manually or on schedule, reveal final results,
   export the full breakdown to CSV.

![Stats Example](https://i.imgur.com/ncnJ1VT.png)

*`/stats` — bot health and usage, also rendered as an image.*

---

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

## Getting started (self-hosting)

Built with TypeScript, discord.js, and Playwright; data lives in Supabase
(Postgres) and polls are rendered by a headless-Chromium render service.

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
