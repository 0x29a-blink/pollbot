# Shareable Results Cards — Design Spike

Design investigation for a "share these results" PNG. No code has been changed
for this spike; it answers the open design questions so the maintainer can
decide whether/how to build.

---

## Feature Overview

When a poll closes (manually, or via the auto-close scheduler), let people
generate a polished **final-results card** — a PNG suited to posting in any
Discord channel or on social media. Built entirely on the existing Playwright
render service; no new architecture.

## 1. What the card shows

Final tally card for a **closed** poll:

- Poll title + (truncated) description
- Winner highlighted (largest weighted total; ties show both)
- Per-option horizontal bars with counts and percentages
- Total votes + total voters
- Server name + icon, poll creator tag
- Small "made with PollBot • pollbot.win" footer (branding/virality)

**Best template base: `renderDetailedView`** (`src/lib/renderBackend.ts:481`).
It already renders per-option results with vote details, so a results card is
mostly a restyle: drop the per-voter rows, add the winner treatment and footer.
`renderPoll` (`renderBackend.ts:37`) is the live-poll image and is tuned for
in-channel width/ratio; the share card wants a squarer, social-friendly canvas
(e.g. 1200×675 for link unfurls), which `renderDetailedView`'s layout is closer
to.

## 2. How it's requested

### Render service (one new branch)

`src/services/renderService.ts:41-47` dispatches on `type`:

```ts
if (type === 'stats') { ... }
else if (type === 'detailed_view') { ... }
else { renderPoll }
```

Add `type === 'results_card'` → new `RenderBackend.renderResultsCard(page, options)`,
and a matching `Renderer.renderResultsCard(data)` client wrapper in
`src/lib/renderer.ts` (mirrors the three existing wrappers at lines 40-50).

### Surfaces (phased)

| Phase | Surface | Returns |
|---|---|---|
| 1 | Dashboard: "Share" button on **closed** polls in `UserServerView`'s poll card, next to Export | PNG download in the browser (API route `GET /api/user/polls/:pollId/share-card` returns `image/png`) |
| 2 (optional) | `/share <poll>` slash command or a "Share Results" button on the closed poll message | Posts the card to the channel |

Phase 1 requires an authenticated API route (session + same permission check
as `/polls/:pollId/export`) that fetches poll + votes, calls
`Renderer.renderResultsCard`, and streams the buffer.

## 3. Vote data source

**Must** use the shared aggregation utility — never hand-rolled (repo rule):

```ts
import { aggregateVotes } from '../lib/voteUtils';
const agg = await aggregateVotes(pollId, pollData.options.length);
// agg.counts (weighted per-option), agg.totalWeight
```

Same call `PollManager.autoClosePoll` and the vote handler use, so the card
always matches the closed poll image. On `agg.error`, return 503 and render
nothing (never a zero-filled card).

## 4. Cost / abuse control

Each render occupies a pooled Chromium page (`src/lib/browserPool.ts`).
The per-poll coalescing in `src/lib/renderQueue.ts` protects *live poll
updates*, not ad-hoc user requests — a share endpoint is a new, user-triggered
render path, so it needs its own guard:

- **Rate limit**: reuse the `checkRateLimit` pattern from
  `src/webapp/pollManagement.ts` (e.g. 5 share-cards / 5 min / user).
- **Cache**: a closed poll's tally is immutable, so cache the PNG per poll id
  (in-memory `Map<pollId, Buffer>` with modest TTL, or store nothing and rely
  on the rate limit at first — measure before adding complexity).
- Restrict to **closed** polls in Phase 1 (immutable output, natural cache key,
  no coalescing questions).

## 5. Open questions for the maintainer

1. **Branding/footer**: exact wording + whether the pollbot.win URL should be
   a QR code or text.
2. **Premium gating**: free (virality lever — every shared card advertises the
   bot) vs premium (pairs with the Vote Analytics gate). Recommendation: free,
   with the footer as the payoff; revisit if render load becomes real.
3. **Canvas size / theme**: 1200×675 social ratio vs Discord-native ~1025px
   width used by existing templates; dark-only or match server settings.
4. **Localization**: card labels ("Total votes", "Winner") should come from
   `src/locales/*.json` via `I18n.t` with the guild's locale, like the poll
   image labels do.
5. **Voter privacy**: card shows aggregate counts only — no voter names. Any
   future "top voter" flourish must respect the same privacy line as Vote
   Analytics (volume only, opt-in).

## Implementation Phases & Effort (coarse)

| Phase | Work | Est. |
|---|---|---|
| 1 | `renderResultsCard` template + render-service branch + `Renderer` wrapper + authed download route + dashboard Share button + rate limit | 6-9 h |
| 2 | `/share` command or message button posting to channel + i18n strings | 3-5 h |
| 3 | PNG cache, QR footer, theme variants | 2-4 h |

## Recommendation

Build Phase 1 only, free (not premium-gated), closed-polls only. It reuses
proven infrastructure end-to-end, and the dashboard button is the cheapest
way to measure whether anyone actually shares results before investing in the
Discord-side command.
