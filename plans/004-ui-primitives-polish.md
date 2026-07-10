# Plan 004: Shared UI primitives + polish pass (Modal, Toast, EmptyState, Skeleton, a11y)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e720b35..HEAD -- dashboard/src`
> Compare "Current state" excerpts against live code where files changed;
> on a mismatch, treat it as a STOP condition. NOTE: plans 002 and 003 are
> expected to have landed first — their changes to `PollCard.tsx`,
> `index.css`, `Home.tsx`, `Leaderboard.tsx`, `Landing.tsx`, and the two
> poll modals are expected drift, not a STOP.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED (behavior-preserving refactor across every dashboard surface)
- **Depends on**: plans/003-design-foundation.md (tokens must exist)
- **Category**: tech-debt / UX
- **Planned at**: commit `e720b35`, 2026-07-09

## Why this matters

This is where "make the dashboard more beautiful" actually lands. Today the
same UI concepts are implemented 3-7 times each with drift:

- **6 hand-rolled modals** (`CreatePollModal`, `EditPollModal`, `ExportModal`,
  `VoterViewModal`, `PremiumGateModal`, plus an inline sync-confirm modal in
  `Home.tsx`) with inconsistent backdrops (most use
  `bg-black/70 backdrop-blur-sm z-50`; `CreatePollModal` has no blur),
  inconsistent close-on-backdrop-click, and no dialog semantics.
- **3 loading paradigms** (spinner, skeleton, plain text like "Loading polls...")
  and rich-vs-bare empty states depending on the page.
- **Native `alert()`/`confirm()`** for feedback (`Home.tsx:165,170`,
  `UserServerView.tsx:600`), and *no* success feedback after mutations.
- **Copy-pasted primitives**: identical `FilterButton` in `PollsView.tsx:200`,
  `ServerView.tsx:132`, `VotersView.tsx:169`; two drifted `Toggle`s in the
  poll modals; `getCsrfToken` re-implemented in 4 files while
  `dashboard/src/utils/api.ts` already exports `apiFetch` that handles CSRF.
- **a11y gaps**: clickable `div`s instead of buttons, icon-only buttons with no
  `aria-label`, no `role="dialog"`/ESC-close/focus handling on any modal.

One primitives layer fixes the polish, the drift, and the accessibility in a
single pass, and makes every future restyle a one-file change.

## Current state

Verified anchor points (line numbers at commit `e720b35`; plans 002/003 may
shift them slightly):

- Modal backdrop exemplar — `EditPollModal.tsx:107`, `ExportModal.tsx:108`,
  `VoterViewModal.tsx:127`, `PremiumGateModal.tsx:54` all:
  ```tsx
  className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
  ```
  `CreatePollModal.tsx:251` differs (no blur). `Home.tsx:467` has an inline
  sync-confirm modal.
- Native dialogs: `Home.tsx:165` `alert(\`Sync failed: ${err.error}\`)`;
  `Home.tsx:170` `alert('Failed to sync guilds')`; `UserServerView.tsx:600`
  `if (!confirm('Are you sure you want to delete this poll from the database? ...'))`.
- Text loading states: `PollsView.tsx:182`
  `<div className="text-center py-8 text-slate-500">Loading polls...</div>`;
  similar in `ServerView.tsx:88` and `VotersView.tsx:111`.
- Skeleton exemplar already exists — `Home.tsx:854`:
  `const SkeletonCard = () => (<div className="glass-panel p-4 h-20 animate-pulse bg-slate-800/20" />)`.
- `FilterButton` triplicated: `PollsView.tsx:200`, `ServerView.tsx:132`,
  `VotersView.tsx:169` (`const FilterButton = ({ active, children, onClick }: any) => (...)`).
- CSRF helper: `dashboard/src/utils/api.ts` exports `apiFetch(url, options)`
  which injects `x-csrf-token` on mutations and `credentials`. Duplicated
  local `getCsrfToken` implementations exist in `Home.tsx`,
  `UserServerView.tsx`, `CreatePollModal.tsx`.
- Design tokens (after plan 003): `@theme` in `dashboard/src/index.css` with
  `--color-primary` (#6366f1); `.glass-panel` utility for card surfaces;
  `Inter Variable` loaded. Use `bg-primary` etc. in new primitives.
- Styling conventions: Tailwind utilities inline, `glass-panel` for surfaces,
  slate palette for neutrals, lucide-react icons, framer-motion
  `AnimatePresence` for enter/exit (keep for modals — it's the one
  load-bearing motion use).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `cd dashboard && npx tsc -b --noEmit` | exit 0 |
| Build | `cd dashboard && npm run build` | exit 0 |
| Lint | `cd dashboard && npm run lint` | exit 0 |

## Scope

**In scope**:
- Create `dashboard/src/components/ui/Modal.tsx`, `ui/Toast.tsx`,
  `ui/EmptyState.tsx`, `ui/Skeleton.tsx`, `ui/FilterButton.tsx`, `ui/Toggle.tsx`
- Migrate: the 5 modal components + `Home.tsx` inline sync modal,
  `PollsView.tsx`, `ServerView.tsx`, `VotersView.tsx`, `UserServerView.tsx`,
  `CreatePollModal.tsx`, `EditPollModal.tsx`
- Replace duplicated `getCsrfToken` usages with `apiFetch` from `utils/api.ts`

**Out of scope**:
- Decomposing the god components (`UserServerView.tsx` 1034 lines, `Home.tsx`
  856 lines) beyond what the migration strictly requires.
- Data-fetching changes, realtime subscriptions, TanStack Query — none of that.
- The Recharts chart components (tooltip hex styling) — only touch if trivial
  (shared constant), otherwise leave.
- Changing any API call semantics. `apiFetch` must produce byte-identical
  requests to the hand-rolled fetches it replaces.

## Git workflow

- Branch: `feat/dashboard-ui-primitives`
- One commit per step. Short imperative messages, no AI/agent references.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `ui/Modal.tsx`

Build one modal primitive that captures the majority pattern:

```tsx
interface ModalProps {
    open: boolean;
    onClose: () => void;
    title?: string;
    /** default true — set false for flows that must not dismiss accidentally (e.g. create-poll mid-form) */
    closeOnBackdrop?: boolean;
    /** tailwind max-width class, default 'max-w-lg' */
    width?: string;
    children: React.ReactNode;
}
```

Requirements:
- Backdrop: `fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4` (the majority style), panel uses `glass-panel`.
- framer-motion `AnimatePresence` + a single consistent enter/exit (fade +
  slight scale), matching the nicest existing one (`EditPollModal`).
- a11y: `role="dialog"` `aria-modal="true"`, `aria-labelledby` wired to the
  title, ESC key closes (respecting `closeOnBackdrop === false`? No — ESC
  should always close unless a `preventClose` is needed; keep it simple: ESC
  honors the same flag), focus moves into the panel on open and returns to the
  trigger on close (store `document.activeElement`). A full focus trap is NOT
  required — moving focus in/out is enough for this pass.
- Header renders `title` + an X close button with `aria-label="Close"`.

**Verify**: `npx tsc -b --noEmit` → exit 0.

### Step 2: `ui/Toast.tsx`

Minimal context-based toast (no new dependency):
`<ToastProvider>` (mount in `App.tsx` inside `ErrorBoundary`), hook
`useToast()` returning `{ success(msg), error(msg) }`. Render stack
bottom-right, `glass-panel` styling, auto-dismiss ~4s, `role="status"`
(success) / `role="alert"` (error). Also export a `useConfirm()` helper or a
small `ConfirmDialog` built on `Modal` for the delete-poll flow.

**Verify**: `npx tsc -b --noEmit` → exit 0.

### Step 3: `ui/Skeleton.tsx`, `ui/EmptyState.tsx`, `ui/FilterButton.tsx`, `ui/Toggle.tsx`

- `Skeleton`: generalize `Home.tsx:854`'s `SkeletonCard`
  (`glass-panel animate-pulse bg-slate-800/20` + height/width props).
- `EmptyState`: icon + heading + optional sub-line + optional action button,
  modeled on the rich empty states already in `Home.tsx` (~line 787) and
  `UserServerView.tsx` (~line 423).
- `FilterButton`: lift the (identical) implementation from `PollsView.tsx:200`;
  type the props properly (no `any`).
- `Toggle`: merge the two drifted versions from `CreatePollModal.tsx:585` and
  `EditPollModal.tsx:297`; keyboard-operable (`<button role="switch"
  aria-checked>`), color via `var(--color-primary)`/`bg-primary`.

**Verify**: `npx tsc -b --noEmit` → exit 0.

### Step 4: Migrate the modals

Wrap each of `EditPollModal`, `ExportModal`, `VoterViewModal`,
`PremiumGateModal`, `CreatePollModal` (set `closeOnBackdrop={false}` for
Create — it currently doesn't close on backdrop click, preserve that), and
replace the inline sync-confirm modal in `Home.tsx:467` with `Modal` +
existing content. Preserve each modal's current close behavior exactly
(which ones close on backdrop click was load-bearing drift: Edit/Export/
Voter/Premium do, Create and Sync don't).

**Verify**: `grep -rn "fixed inset-0 bg-black/70" dashboard/src/components dashboard/src/pages` → matches only in `ui/Modal.tsx`. Typecheck + build pass.

### Step 5: Toasts + confirm instead of native dialogs; success feedback

- `Home.tsx:165,170`: replace `alert(...)` with `toast.error(...)`; add a
  `toast.success('Guild sync started')` on the OK path.
- `UserServerView.tsx:600`: replace `confirm(...)` with the `ConfirmDialog`
  (danger-styled confirm button); add `toast.success('Poll deleted')` on
  success.
- Add success toasts to the main mutations: poll created
  (`CreatePollModal.tsx`, after the successful POST ~line 212), settings saved
  (`EditPollModal`), poll closed/reopened and export completed
  (`UserServerView.tsx` handlers).

**Verify**: `grep -rn "alert(\|confirm(" dashboard/src --include=*.tsx` → no
matches (window.alert/confirm; ignore any unrelated identifier).

### Step 6: Loading & empty state sweep

Replace the plain-text loading divs (`PollsView.tsx:182`, `ServerView.tsx:88`,
`VotersView.tsx:111`) with `Skeleton` rows matching each list's card shape,
and the bare one-line empty states in the same pages with `EmptyState`.
Delete the three local `FilterButton` definitions and import the shared one.

**Verify**: `grep -rn "const FilterButton" dashboard/src/pages` → no matches;
`grep -rn "Loading polls...\|Loading details...\|Loading registry" dashboard/src` → no matches.

### Step 7: CSRF consolidation + icon-button labels

- Replace local `getCsrfToken` definitions/usages in `Home.tsx`,
  `UserServerView.tsx`, `CreatePollModal.tsx` with `apiFetch` from
  `dashboard/src/utils/api.ts` (same URL, method, body; `apiFetch` adds the
  header itself).
- Sweep icon-only buttons (logout, back arrows e.g. `ServerView.tsx:79`, every
  modal X) and add `aria-label`s. Convert clickable `div`s that act as buttons
  (server cards `Home.tsx:756`, poll-card headers `PollCard.tsx:26`, toggle
  rows) to `<button>`/`role="button"` + keyboard handling where converting the
  element would break layout.

**Verify**: `grep -rn "function getCsrfToken\|const getCsrfToken" dashboard/src --include=*.tsx` → only `utils/api.ts`. Typecheck, build, lint all exit 0.

## Test plan

No dashboard test harness exists; behavior-preservation is verified manually.
Minimum manual pass (dev server, non-admin + admin account):
1. Open/close every modal via button, X, backdrop (where enabled), and ESC.
2. Create a poll end-to-end (CSRF must still work — watch for 403s).
3. Delete a poll → styled confirm → success toast.
4. Trigger a sync failure (non-admin hitting sync, or stop the API) → error toast, no native alert.
5. Load each list page cold → skeletons, then content or EmptyState.

If any manual check can't be run, say so explicitly in the completion report.

## Done criteria

- [ ] `cd dashboard && npx tsc -b --noEmit && npm run build && npm run lint` all exit 0
- [ ] `dashboard/src/components/ui/` contains Modal, Toast, EmptyState, Skeleton, FilterButton, Toggle
- [ ] Greps in steps 4-7 all clean
- [ ] Every `ui/` primitive uses theme tokens (no new hardcoded `#hex` in `ui/`)
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Plan 003 has not been executed (no `@theme` block in `index.css`).
- Replacing a fetch with `apiFetch` would change the request (different
  header name, missing credentials) — compare `utils/api.ts` first; if the
  backend expects something `apiFetch` doesn't send, report instead of patching `apiFetch`.
- A modal's behavior can't be reproduced by the primitive without adding a
  third configuration flag beyond `closeOnBackdrop`/`width` — report; the
  primitive growing modal-specific flags defeats the purpose.
- `UserServerView.tsx` migration requires touching its data-fetch logic.

## Maintenance notes

- New UI concept? It goes in `dashboard/src/components/ui/` first. Reviewers
  should reject new one-off modals/toggles/spinners.
- The inline PollCard inside `UserServerView.tsx` and the standalone
  `PollCard.tsx` remain two components (unification deferred — tracked in
  `plans/README.md`); both should consume these primitives when eventually
  merged.
- Deferred: framer-motion reduction (one-shot fades → CSS `.animate-fade-in`),
  chart theming, mobile layout for `VotersView` table.
