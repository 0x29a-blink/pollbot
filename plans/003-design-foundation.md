# Plan 003: Establish a single design foundation for the dashboard (tokens, font, dead config)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e720b35..HEAD -- dashboard/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt (prerequisite for the visual redesign)
- **Planned at**: commit `e720b35`, 2026-07-09

## Why this matters

The maintainer wants the dashboard "more beautiful." Right now a visual
refresh is impossible to do cleanly because the foundation is fractured:

- The brand primary color has ~5 definitions (`#6366f1` CSS var, `bg-indigo-600`
  utilities, inline `#4f46e5`, inline `rgb(79, 70, 229)`).
- **Visible rendering bug**: several components build Tailwind classes by string
  interpolation (`bg-${color}-500/10`). Tailwind v4's JIT only generates
  classes that appear as complete literals in source, so these icon tiles and
  accents silently render with no background/color on the Landing page, admin
  stats deck, and leaderboards.
- The declared font (`'Inter'`) is never loaded — there is no `@font-face`,
  no fonts link in `dashboard/index.html`, no package import. Every user sees
  `system-ui`.
- Dead config misleads every future edit: `dashboard/tailwind.config.js` is a
  v3-style JS config **ignored** by the Tailwind 4 CSS-first setup
  (`index.css` starts with `@import "tailwindcss"` and has no `@config`
  directive); `dashboard/src/App.css` is the unmodified Vite starter
  stylesheet imported by nothing; `dashboard/src/components/PasswordModal.tsx`
  (137 lines) is imported by nothing.

This plan creates one token layer, fixes the purged-class bug, actually loads
the font, and deletes the dead weight. Plan 004 (shared UI primitives) builds
on it.

## Current state

Files and roles:

- `dashboard/src/index.css` — Tailwind v4 entry (`@import "tailwindcss"` at
  line 1), `:root` CSS variables (lines 4-14), and utility classes
  `.glass-panel` / `.title-gradient` / `.btn-primary` / `.container-wide` /
  `.grid-stats` / `.server-grid` / `.animate-fade-in` / `.chart-container`
  (lines 47-118).
- `dashboard/src/main.tsx` — imports `./index.css`; the only global CSS entry.
- `dashboard/index.html` — plain HTML shell; no font `<link>`.
- `dashboard/tailwind.config.js` — ignored v3-style config (verify before
  deleting, Step 5).
- `dashboard/src/App.css` — unused Vite starter (`#root { max-width: 1280px; ... }`,
  `.logo`, `.read-the-docs`); imported nowhere (verified: `grep -rn "App.css" dashboard/src/` → no matches).
- `dashboard/src/components/PasswordModal.tsx` — unused (verified: no imports outside its own file).
- Interpolated-class sites (all verified):
  - `dashboard/src/pages/Home.tsx:814` — `` <div className={`p-2 rounded-lg bg-${color}-500/10`}> `` inside `StatsCard`; callers pass `color` = `"blue" | "emerald" | "violet" | "amber"` (lines 519-528).
  - `dashboard/src/components/Leaderboard.tsx:26` — `` bg-${color}-500/10 rounded-lg text-${color}-400 `` and `:62` — `` text-${color}-400 ``; callers pass `"yellow"` and `"amber"` (Home.tsx:546,554).
  - `dashboard/src/pages/Landing.tsx:155` — `` bg-${feature.color}-500/10 ... text-${feature.color}-400 ... ring-${feature.color}-500/20 ... ring-${feature.color}-500/40 `` — colors come from the `features` array earlier in the same file.
- Inline primary-color duplicates:
  - `dashboard/src/components/CreatePollModal.tsx` — inline style `#4f46e5` (Toggle, ~line 600).
  - `dashboard/src/components/EditPollModal.tsx` — inline style `rgb(79, 70, 229)` (Toggle, ~line 328).
  - `.btn-primary` in `index.css` uses `var(--color-primary)` = `#6366f1`.

`dashboard/src/index.css:4-14` today:

```css
:root {
  --color-bg: #0a0a0f;
  --color-card-bg: rgba(22, 22, 30, 0.6);
  --color-card-border: rgba(255, 255, 255, 0.1);
  --color-primary: #6366f1;
  --color-primary-glow: rgba(99, 102, 241, 0.5);
  --color-text-main: #ffffff;
  --color-text-muted: #9ca3af;
  --font-family: 'Inter', system-ui, -apple-system, sans-serif;
  --glass-blur: blur(12px);
}
```

Conventions: React 19 function components, Tailwind utility classes inline,
4-space indent in some files / 2 in others (match each file you touch),
lucide-react icons.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install (only for the font package) | `cd dashboard && npm install @fontsource-variable/inter` | exit 0, lockfile updated |
| Typecheck | `cd dashboard && npx tsc -b --noEmit` | exit 0 |
| Build | `cd dashboard && npm run build` | exit 0 |
| Lint | `cd dashboard && npm run lint` | exit 0 |

## Scope

**In scope**:
- `dashboard/src/index.css`
- `dashboard/src/main.tsx` (font import line only)
- `dashboard/package.json` + `dashboard/package-lock.json` (font dependency)
- `dashboard/src/pages/Home.tsx` (StatsCard color map only)
- `dashboard/src/components/Leaderboard.tsx` (color map only)
- `dashboard/src/pages/Landing.tsx` (feature color map only)
- `dashboard/src/components/CreatePollModal.tsx`, `EditPollModal.tsx` (replace inline primary hex/rgb only)
- Delete: `dashboard/tailwind.config.js`, `dashboard/src/App.css`, `dashboard/src/components/PasswordModal.tsx`

**Out of scope**:
- Any layout/spacing/visual redesign beyond the color/font/token mechanics — plan 004 owns restyling.
- `dashboard/index.html` fonts via CDN — we self-host (the dashboard is served through a cloudflared tunnel; avoid third-party font requests).
- Backend files. The two chart components' hardcoded hexes (`charts/*.tsx`) — noted for plan 004; leave them.

## Git workflow

- Branch: `chore/dashboard-design-foundation`
- Commit per step; short imperative messages, no AI/agent references.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Load Inter for real

```
cd dashboard && npm install @fontsource-variable/inter
```

In `dashboard/src/main.tsx`, add as the FIRST import:
`import '@fontsource-variable/inter';`

In `dashboard/src/index.css`, change the font var to the variable-font family
name: `--font-family: 'Inter Variable', 'Inter', system-ui, -apple-system, sans-serif;`

**Verify**: `npm run build` → exit 0, and the `dist/assets` output contains a
woff2 file (`ls dist/assets | grep -i woff2` → at least one match).

### Step 2: Promote tokens to a Tailwind v4 `@theme`

In `dashboard/src/index.css`, immediately after `@import "tailwindcss";`, add:

```css
@theme {
    --color-primary: #6366f1;      /* indigo-500 — the one true brand accent */
    --color-primary-strong: #4f46e5; /* indigo-600 — hover/active */
    --color-surface: #0a0a0f;
}
```

Tailwind v4 generates utilities from `@theme` variables, so `bg-primary`,
`text-primary`, `border-primary`, `bg-primary/10` etc. become available.
Keep the existing `:root` block for now (`.glass-panel` etc. read from it),
but change `:root`'s `--color-primary` and `--color-primary-glow` to reference
the theme: they may simply stay identical values — the invariant to enforce is
that **`#4f46e5` / `rgb(79, 70, 229)` / `#6366f1` appear nowhere in `src/` outside
`index.css`** after this plan.

Also delete the stray `/* Force refresh */` comment at line 2.

**Verify**: `npm run build` → exit 0. Add a temporary `bg-primary` class to any
element, build, and grep the CSS output: `grep -o "bg-primary" dist/assets/*.css | head -1` → match. Remove the temporary class.

### Step 3: Fix the purged dynamic classes with literal lookup maps

Pattern to apply at each site — a `Record` of complete class strings (Tailwind
sees the literals; nothing is purged):

`dashboard/src/pages/Home.tsx` (StatsCard, line ~814): above the component add

```tsx
const statTileClasses: Record<string, string> = {
    blue: 'bg-blue-500/10',
    emerald: 'bg-emerald-500/10',
    violet: 'bg-violet-500/10',
    amber: 'bg-amber-500/10',
};
```

and replace `` `p-2 rounded-lg bg-${color}-500/10` `` with
`` `p-2 rounded-lg ${statTileClasses[color] ?? 'bg-slate-500/10'}` ``.

`dashboard/src/components/Leaderboard.tsx` (lines 26 and 62): same technique
with the colors actually passed (`yellow`, `amber`) — map to
`{ tile: 'bg-yellow-500/10 text-yellow-400', value: 'text-yellow-400' }`-style
entries covering both call sites, with a neutral fallback.

`dashboard/src/pages/Landing.tsx` (line 155): find the `features` array in the
same file, enumerate its `color` values, and build one map from color →
complete string for the tile (`bg-X-500/10 text-X-400 ring-X-500/20
group-hover:ring-X-500/40`). Replace the four interpolations with the map
lookup. Simplest robust shape: store the full tile className per color.

**Verify**: `grep -rn 'bg-\${' dashboard/src` → no matches; same for
`text-\${` and `ring-\${`. `npm run build` → exit 0. Visual check if a dev
server is available: Landing feature icons show tinted backgrounds again.

### Step 4: Replace inline primary colors in the two Toggles

In `CreatePollModal.tsx` (~line 600) and `EditPollModal.tsx` (~line 328),
locate the inline styles containing `#4f46e5` / `rgb(79, 70, 229)` and replace
the color value with `var(--color-primary)` (keep the rest of the inline style
mechanics — full Toggle unification is plan 004's job, don't restructure the
components here).

**Verify**: `grep -rn "4f46e5\|79, 70, 229" dashboard/src` → no matches.

### Step 5: Delete dead files

1. Confirm each is genuinely unreferenced (all three verified at planning time,
   re-verify for drift):
   - `grep -rn "App.css" dashboard/src dashboard/index.html` → no matches
   - `grep -rn "PasswordModal" dashboard/src --include=*.tsx -l` → only the component's own file
   - `grep -rn "@config" dashboard/src/index.css` → no matches (JS config really is ignored)
2. Delete `dashboard/src/App.css`, `dashboard/src/components/PasswordModal.tsx`,
   `dashboard/tailwind.config.js`.

**Verify**: `cd dashboard && npx tsc -b --noEmit && npm run build && npm run lint` → all exit 0.

## Test plan

No dashboard test harness exists. Gates: typecheck, build, lint, plus the
greps in each step. If a dev server is available (`cd dashboard && npm run dev`),
spot-check Landing, the admin dashboard stats deck, and both leaderboards for
restored icon-tile tinting and the Inter font (DevTools → computed
`font-family` shows "Inter Variable").

## Done criteria

- [ ] `cd dashboard && npx tsc -b --noEmit` exits 0
- [ ] `cd dashboard && npm run build` exits 0; woff2 in `dist/assets`
- [ ] `grep -rn 'bg-\${\|text-\${\|ring-\${' dashboard/src` → no matches
- [ ] `grep -rn "4f46e5\|79, 70, 229" dashboard/src` → no matches
- [ ] `dashboard/tailwind.config.js`, `dashboard/src/App.css`, `dashboard/src/components/PasswordModal.tsx` deleted
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `index.css` does not start with `@import "tailwindcss"` or a `@config`
  directive exists (the JS config would then be LIVE, and deleting it would
  change styling).
- Any grep in Step 5.1 finds a real reference to a "dead" file.
- After Step 2, `bg-primary` does not appear in built CSS (Tailwind version
  mismatch — check `dashboard/package.json` has `tailwindcss` ^4).
- The `features` array in `Landing.tsx` gets colors from outside the file.

## Maintenance notes

- From now on the rule is: **new colors go through `@theme` tokens; no dynamic
  class interpolation ever** (Tailwind cannot see runtime strings). A reviewer
  should reject any new `` bg-${...} `` in PRs.
- Plan 004 builds shared primitives on these tokens; if you change token names
  here, update plan 004 before executing it.
- Deferred to plan 004: chart color hardcodes in
  `dashboard/src/components/charts/*.tsx`, modal/button consolidation.
