# Plan 009: Duplicate-poll button (build) + shareable results card (spike)

> **Executor instructions**: Follow this plan step by step. Part A is a build;
> Part B is an investigation spike whose deliverable is a WRITTEN design doc,
> not shipped code. Run every verification command and confirm the expected
> result before moving on. If anything in the "STOP conditions" section
> occurs, stop and report — do not improvise. When done, update the status
> row for this plan in `plans/README.md` — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat e720b35..HEAD -- dashboard/src/pages/UserServerView.tsx dashboard/src/components/CreatePollModal.tsx src/lib/renderBackend.ts src/services/renderService.ts`
> Compare "Current state" excerpts on changed files; mismatch = STOP. Changes
> from plans 003/004/005 are expected drift.

## Status

- **Priority**: P3
- **Effort**: S-M (Part A) + S (Part B spike)
- **Risk**: LOW
- **Depends on**: none. If plan 005 landed, the duplicate flow should ALSO copy nothing time-related (see Part A rules).
- **Category**: direction (feature)
- **Planned at**: commit `e720b35`, 2026-07-09

## Why this matters

**Duplicate**: the repo has a complete *export* surface (`src/commands/export.ts`,
`export_ctx.ts`, `src/lib/exportManager.ts`, `dashboard/src/components/ExportModal.tsx`)
but no way to get poll data back *in* — servers that run the same poll weekly
rebuild every field by hand. `docs/poll-scheduling-plan.md:186` names "poll
templates" as Phase 3 intent; a duplicate button is the cheap 80% of that.

**Share cards**: the render service already dispatches three PNG types —
`src/services/renderService.ts:41-47`:
```ts
if (type === 'stats') {
    buffer = await RenderBackend.renderStats(page, options);
} else if (type === 'detailed_view') {
    buffer = await RenderBackend.renderDetailedView(page, options);
} else {
    buffer = await RenderBackend.renderPoll(page, options);
}
```
A "final results" share card is one more branch on paid-for infrastructure,
but user demand is inferred — so it gets a spike (design + open questions),
not a build.

## Current state

- `dashboard/src/pages/UserServerView.tsx` — the per-server management page.
  Contains an inline PollCard (~lines 464-942) with action buttons
  (close/reopen, export, delete — find the handlers passed in at ~lines
  434-443) and mounts `CreatePollModal` (search `CreatePollModal` in the file
  for its `open` state and props).
- `dashboard/src/components/CreatePollModal.tsx` — create form. Form state at
  lines 63-70:
  ```ts
  const [formData, setFormData] = useState<...>({
      description: '',
      options: ['', ''],
      settings: { public: true, allow_thread: false, ... }
  });
  ```
  (Read the full initial state and the props interface at the top of the file
  before changing anything.)
- Poll settings shape (what a duplicate must copy):
  `public, allow_thread, allow_close, allow_exports, max_votes, min_votes,
  allowed_roles, vote_weights, role_metadata` — see
  `src/webapp/pollManagement.ts:481-498`.
- `src/lib/renderBackend.ts` (715 lines) — HTML-template + screenshot logic
  for the three render types; `renderDetailedView` is the closest relative of
  a results card.
- Rendering pipeline: bot/API → HTTP POST to the render service
  (`src/lib/renderer.ts`) → `renderService.ts` → `RenderBackend` on a pooled
  Chromium page (`browserPool.ts`), coalesced per poll by `renderQueue.ts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Dashboard | `cd dashboard && npx tsc -b --noEmit && npm run build` | exit 0 |
| Backend (spike shouldn't change code, but verify no accidental edits) | `npm run typecheck` | exit 0 |

## Scope

**In scope (Part A — build)**:
- `dashboard/src/pages/UserServerView.tsx` — "Duplicate" action on the inline poll card
- `dashboard/src/components/CreatePollModal.tsx` — accept optional `initialValues`

**In scope (Part B — spike, writes docs only)**:
- `docs/share-cards-spike.md` (create)

**Out of scope**:
- Saved templates (new table/CRUD) — explicitly deferred until duplicate
  proves demand.
- Any change to `renderBackend.ts`, `renderService.ts`, or new endpoints in
  Part B — the spike DESIGNS the change, it does not make it.
- Bot-side `/poll duplicate` command.
- The admin `PollCard.tsx` (read-only surfaces don't create polls).

## Git workflow

- Branch: `feat/duplicate-poll`
- Commit per part; short imperative messages, no AI/agent references.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Part A, Step 1: `initialValues` prop on `CreatePollModal`

Add an optional prop:

```ts
interface CreatePollModalProps {
    // ...existing props — keep them all...
    initialValues?: {
        title: string;
        description: string;
        options: string[];
        settings: Partial<PollSettings>;
    };
}
```

When `initialValues` is provided, initialize `formData` from it instead of the
blank defaults (merge: `settings: { ...blankDefaults, ...initialValues.settings }`).
Because the modal instance may be reused, reset the form whenever the modal
opens with new `initialValues` (a `useEffect` keyed on the modal's `open` flag
— check how the modal's visibility is controlled in this file and key off
that). Title suggestion: prefill as-is (do NOT append "(copy)" — the creator
sees the form and can edit).

Rules for what a duplicate copies: `title`, `description`, `options`, and the
settings listed in "Current state". It must NOT copy: votes (nothing to copy —
new poll), `message_id`/`channel_id` (user re-picks the channel), and — if
plan 005 has landed — NOT `ends_at` (a stale close time on a fresh poll is a
trap; leave duration at "None").

**Verify**: `cd dashboard && npx tsc -b --noEmit` → exit 0; existing create
flow unchanged when the prop is absent.

### Part A, Step 2: Duplicate action on the poll card

In `UserServerView.tsx`'s inline PollCard action row, add a "Duplicate" button
(lucide `Copy` icon, styled like the neighboring action buttons; include
`aria-label="Duplicate poll"`). Clicking it opens the existing
`CreatePollModal` with `initialValues` mapped from the card's `poll` object.
State plumbing: the page already owns the modal-open state — add a
`duplicateSource: Poll | null` state next to it; the button sets it and opens
the modal; closing the modal clears it.

**Verify**: `cd dashboard && npx tsc -b --noEmit && npm run build` → exit 0.
Manual (dev stack): duplicate a poll with 3+ options, a role restriction, and
`max_votes: 2` → form arrives prefilled; submitting posts a NEW poll to the
chosen channel; the original is untouched.

### Part B: Share-card spike → `docs/share-cards-spike.md`

Investigate (read `renderBackend.ts`'s `renderDetailedView` and `renderPoll`
templates, `renderer.ts`'s client call, `renderQueue.ts`) and write a design
doc — follow the structure of `docs/poll-scheduling-plan.md` (Feature
Overview / How It Works / Options with pros-cons / Phases / Estimated Effort).
It must answer:

1. **What the card shows**: final tally card for a closed poll — title, winner
   highlight, per-option bars, total votes, server name/icon, "made with
   PollBot" footer. Which existing template (`detailed_view` vs `poll`) is the
   better base, with specific function/line references.
2. **How it's requested**: proposed new `type: 'results_card'` branch in
   `renderService.ts:41-47` + a `RenderBackend.renderResultsCard`; which
   surfaces trigger it (dashboard "Share" button on closed polls; optional
   `/share` command later) and what each returns (PNG download vs posting to
   the Discord channel).
3. **Vote data source**: must go through `aggregateVotes` /
   `aggregateVoteRows` from `src/lib/voteUtils.ts` (repo rule: never hand-roll
   aggregation) — name the exact call.
4. **Cost/abuse**: renders are Chromium-priced; per-poll coalescing exists in
   `renderQueue.ts` — does a user-triggered share need rate limiting? Propose
   a simple guard.
5. **Open questions** for the maintainer: branding/footer, whether share
   cards are premium-gated (ties to plan 008), dark/light variants,
   localization of card labels (i18n keys live in `src/locales/`).
6. **Effort estimate** per phase, coarse.

**Verify**: `docs/share-cards-spike.md` exists, answers all six numbered
points, and `git status` shows no source-code changes from Part B.
`npm run typecheck` → exit 0 (proves nothing was touched).

## Test plan

- Part A manual test as in Step 2 (dev guild only — never production).
- No new unit tests required: the duplicate flow is prop-plumbing over the
  already-exercised create path. If you extract a `pollToInitialValues(poll)`
  mapper, it must live in the dashboard and needs no backend test.

## Done criteria

- [ ] `cd dashboard && npx tsc -b --noEmit && npm run build` exits 0
- [ ] `npm run typecheck` exits 0 with no backend diffs (`git diff --stat -- src/` empty)
- [ ] `grep -n "initialValues" dashboard/src/components/CreatePollModal.tsx` → ≥ 2 matches
- [ ] `grep -n "Duplicate" dashboard/src/pages/UserServerView.tsx` → ≥ 1 match
- [ ] `docs/share-cards-spike.md` exists with all six sections
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `CreatePollModal`'s form state shape differs materially from the excerpt
  (drift — e.g. plan 005 added duration fields; adapt only if the merge is
  obvious, otherwise report).
- The modal is mounted per-open (remounts on open) — then the `useEffect`
  reset is unnecessary; note it and simplify, but confirm by reading the
  mount site first.
- You find an existing duplicate/clone mechanism anywhere (search first:
  `grep -rin "duplicate\|clone" dashboard/src src/`) — the plan's premise
  would be wrong.

## Maintenance notes

- If duplicate gets heavy use (observable via plan 007's `usage_events` — add
  `'poll_duplicate'` as the event when both plans have landed; one line in the
  duplicate handler), that's the demand signal for real saved templates.
- The spike doc should be reviewed by the maintainer before anyone builds
  share cards; it intentionally ends at open questions.
