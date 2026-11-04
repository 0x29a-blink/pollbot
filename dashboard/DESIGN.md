# PollBot dashboard — design system

Fluent (Windows 11 dark) + Discord + Material 3, in PollBot blue. Clean, crisp,
flat, efficient. Read this before touching any screen.

## The look in one paragraph

A Discord layout — server rail, a channel-style sidebar with the user panel at its
foot, a content area — drawn in Fluent's materials: a mica ground (`#202020`), a
content "layer" one tone lighter (`#272727`) with a rounded top-left corner, cards
one more tone up (`#2e2e2e`) with a quiet 1px edge, 8px card radius and 4px
control radius, Segoe UI Variable. Material 3 supplies behaviour: state layers
(hover = white overlay at 6%, never a hue change), tonal/outlined/text button
hierarchy, segmented buttons, chips. Elevation is a lightness step. No glows, no
gradients, no glass/blur, no shadows on resting cards.

## Tokens (see `src/index.css`)

| Role | Utility | Value |
| --- | --- | --- |
| Rail / ground / sheet | `bg-rail` `bg-ground` `bg-sheet` | #16171b / #1e2025 / #26282f |
| Card / nested / floating | `bg-surface` `bg-raised` `bg-overlay` | #2e3139 / #373b45 / #2b2e37 |
| Card edge / row rule / input edge | `border-line` `border-rule` `border-control` | #3c404c / #353944 / #4c5162 |
| Text | `text-ink` `text-muted` `text-faint` | #fff / #cacfd9 / #9ca3b4 (all ≥4.5:1) |
| PollBot blue | `bg-brand` `text-brand-text` `bg-data` | #5865f2 fill / #9aa2ff text / #6d78f9 chart |
| Fluenty sky-cyan | `bg-cyan` `bg-cyan-soft` `text-cyan` | #60cdff accent / #1b3848 tonal |
| Status | `text-positive` `text-negative` `text-warning` (+ `-soft` bg) | #4cc38a / #f2777d / #f0b232 |

Old Tailwind palettes are remapped: `slate-*` → neutral greys, `indigo/violet/blue/cyan-*`
→ PollBot blue. Don't rely on that in new code — use the semantic tokens.

## Components (CSS classes in index.css, React in `components/ui/primitives.tsx`)

- `AppShell` + a sidebar (`HomeSidebar`, `AdminSidebar`, `GuildSidebar`) wraps every
  signed-in screen. `PageHeader` gives the one `h1` (28px semibold noun, no
  greeting) + one grey sentence about the data + actions on the right.
- `.panel` / `<Panel title meta actions>` — the only card. Header row 52px, 20px padding.
- `<KpiStrip><Kpi label value caption/></KpiStrip>` — one container split by
  1px rules. No icons, no tinted tiles, no sparklines. Values tabular (`num`).
- Buttons: `.btn` + `.btn-primary` (brand fill — **one per screen**), `.btn-tonal`,
  `.btn-outline`, `.btn-ghost`, `.btn-danger`; sizes `.btn-sm` (28px) / default 32 /
  `.btn-lg` 40; `.btn-icon` for square icon buttons (needs `aria-label`).
- Inputs: `.field` (Fluent text box, accent underline on focus); `<SearchField>`.
- `.segmented` with `<button aria-pressed>` children for filters/tabs.
- `.chip` + `chip-positive|negative|warning|brand` + `chip-dot` — pale tint, ink of
  the same hue. One status mark per row. `<PollStatusChip>`.
- `.data-table` — 12px grey sentence-case headers, no header band, no zebra, 1px
  row rules, numbers right-aligned (`th.num`, `td.num`).
- `.row-interactive` — M3 state layer on clickable rows.
- `<GuildIcon>`, `<Avatar>`, `<Dash>` (grey em dash for missing), `<InlineError>`
  (error inside the failed block + Retry), `<EmptyBlock>`, `<Freshness>`,
  `<ShareBar>`; `.skeleton` flat grey bars at the real size (no shimmer).
- Charts: Recharts styled via `src/lib/chartTheme.ts` (`gridProps`, `axisProps`,
  `tooltipProps`, `chart.data`). One hue per chart (PollBot blue on the main
  series, neutral grey otherwise), 2px straight lines (`type="linear"`), no dots,
  no gradient fills (a flat ≤14% fill is OK), square bars or 2px top radius, no
  legend for a single series. Dates from `YYYY-MM-DD` must be formatted with
  `timeZone: 'UTC'` and the card says "(UTC)".
- Formatting: `src/lib/format.ts` — `fmtCount` (separators, em dash for null),
  `fmtPct`, `fmtDate`, `fmtDateTime`, `fmtRelative`, `plural`, `toNum`. A real zero
  prints `0`; a missing value prints a grey dash. Never `{n && ...}` with numbers.

## Rules

- Type: 28 title / 20 subtitle / 14 body / 12-13 meta. Weights 400/500/600 only.
  No uppercase tracked labels, no monospace (except IDs), no emoji, no `font-mono`
  on numbers (use `num`).
- Colour on data, status and the one primary action only. No coloured icon tiles,
  no per-card accent colours, no amber/violet/cyan decoration.
- Sentence case everywhere ("Create poll", not "Create Poll").
- Grids close: cards in a row share edges and bottoms; pick column counts from the
  number of items; lists on an overview are capped with "View all".
- Every block has loading (skeleton at real size), empty (frame kept + one
  sentence), and error (`InlineError` with Retry) states.
- No entrance animations (`initial={{opacity:0,y:20}}` etc.). Motion is feedback only:
  hover/press state layers, menus and dialogs opening.
- Accessible: real `<button>`/`<a>`, `aria-label` on icon buttons, visible focus.

## Previewing without a backend

`VITE_MOCK_API=1 npm run dev` (from `dashboard/`) serves sample data from
`src/dev/mockApi.ts` — signed in as an admin with six servers. Extend the mock
when a screen needs data it doesn't have yet.
