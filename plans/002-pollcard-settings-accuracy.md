# Plan 002: Make the admin PollCard display the poll settings that actually exist

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e720b35..HEAD -- dashboard/src/components/PollCard.tsx dashboard/src/types.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `e720b35`, 2026-07-09

## Why this matters

The admin dashboard's poll card (used on the global Polls page and per-server
admin page) renders a "Configuration" panel from settings fields that **no
write path in the entire codebase produces**: `private`, `allow_multivote`,
`hide_results`, and `weights`. The real settings written by both the `/poll`
command (`src/commands/poll.ts:313-325`) and the dashboard create endpoint
(`src/webapp/pollManagement.ts:585-595`) are `public`, `allow_thread`,
`allow_close`, `allow_exports`, `max_votes`, `min_votes`, `allowed_roles`,
`vote_weights`, `role_metadata`. Result: admins always see "Private: No",
"Multi-Vote: No", "Results: Public" regardless of the poll's actual
configuration — wrong information presented as fact. This is part of the
maintainer's "confirm dashboard values are accurate" request.

## Current state

- `dashboard/src/components/PollCard.tsx` — the read-only admin poll card,
  imported by `dashboard/src/pages/PollsView.tsx` and
  `dashboard/src/pages/ServerView.tsx`. (Note: `dashboard/src/pages/UserServerView.tsx`
  contains a *different, inline* PollCard — that one reads the correct fields
  and is NOT part of this plan.)
- `dashboard/src/types.ts:10-26` — `PollSettings` carries both the real fields
  and the phantom ones, self-documented as legacy:

```ts
export interface PollSettings {
    public?: boolean;
    allow_thread?: boolean;
    allow_close?: boolean;
    allow_exports?: boolean;
    max_votes?: number;
    min_votes?: number;
    allowed_roles?: string[];
    vote_weights?: Record<string, number>;
    /** Role metadata for dashboard display (name, color) */
    role_metadata?: Record<string, { name: string; color: number }>;
    // Legacy/alternate property names used in some components
    private?: boolean;
    allow_multivote?: boolean;
    hide_results?: boolean;
    weights?: Record<string, number>;
}
```

- `dashboard/src/components/PollCard.tsx:103-119` — the wrong reads:

```tsx
<SettingItem icon={<Calendar .../>} label="Created" value={new Date(poll.created_at).toLocaleString()} />
<SettingItem icon={<Settings .../>} label="Private" value={poll.settings?.private ? 'Yes' : 'No'} />
<SettingItem icon={<Info .../>} label="Multi-Vote" value={poll.settings?.allow_multivote ? 'Yes' : 'No'} />
<SettingItem icon={<PieChart .../>} label="Results" value={poll.settings?.hide_results ? 'Hidden' : 'Public'} />
<SettingItem icon={<Settings .../>} label="Min Votes" value={poll.settings?.min_votes || 'None'} />
<SettingItem icon={<Settings .../>} label="Max Votes" value={poll.settings?.max_votes || 'None'} />
```

and at line 113 and 116-118: `poll.settings?.allowed_roles` (correct field,
but renders raw role IDs) and `poll.settings?.weights` (phantom — real field
is `vote_weights`).

- Semantics of the real fields (from `src/commands/poll.ts:41-44` and
  `src/lib/pollManager.ts:87`): `public` = whether live vote counts are shown
  while the poll is open (`const showVotes = !active || settings.public`).
  `max_votes`/`min_votes` = how many options a voter selects. `allowed_roles`
  = role IDs allowed to vote (empty = everyone). `role_metadata` maps role ID
  → `{ name, color }` for display.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Dashboard typecheck | `cd dashboard && npx tsc -b --noEmit` | exit 0 |
| Dashboard build | `cd dashboard && npm run build` | exit 0 |

(There are no dashboard unit tests in this repo; verification is typecheck +
build + the grep-based done criteria.)

## Scope

**In scope**:
- `dashboard/src/components/PollCard.tsx`
- `dashboard/src/types.ts` (remove the four legacy fields)

**Out of scope**:
- `dashboard/src/pages/UserServerView.tsx` and its inline PollCard — separate
  component, reads the correct fields already.
- `EditPollModal.tsx` / `CreatePollModal.tsx` — they already use the real shape.
- Any backend file. The stored settings are correct; only the display is wrong.
- Visual restyling (that's plan 004's job) — keep the existing classes/layout.

## Git workflow

- Branch: `fix/pollcard-settings`
- Commit style: short imperative sentence (match `git log`). No AI/agent references in commit messages.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Remove the legacy fields from `PollSettings`

In `dashboard/src/types.ts`, delete the four lines under the
`// Legacy/alternate property names used in some components` comment and the
comment itself (`private`, `allow_multivote`, `hide_results`, `weights`).

**Verify**: `cd dashboard && npx tsc -b --noEmit` → it should now FAIL, with
errors ONLY in `src/components/PollCard.tsx`. If any *other* file errors on
these fields, STOP (see STOP conditions) — another component depends on the
phantom fields and the plan's premise is wrong.

### Step 2: Rewrite the Configuration panel to the real fields

In `dashboard/src/components/PollCard.tsx:103-119`, replace the setting rows:

```tsx
<SettingItem icon={<Calendar className="w-4 h-4" />} label="Created" value={new Date(poll.created_at).toLocaleString()} />
<SettingItem icon={<PieChart className="w-4 h-4" />} label="Live Results" value={poll.settings?.public !== false ? 'Visible' : 'Hidden until close'} />
<SettingItem icon={<Info className="w-4 h-4" />} label="Selections" value={`${poll.settings?.min_votes ?? 1}–${poll.settings?.max_votes ?? 1}`} />
<SettingItem icon={<Settings className="w-4 h-4" />} label="Thread" value={poll.settings?.allow_thread ? 'Yes' : 'No'} />
<SettingItem icon={<Settings className="w-4 h-4" />} label="Close Button" value={poll.settings?.allow_close !== false ? 'Yes' : 'No'} />
<SettingItem icon={<Settings className="w-4 h-4" />} label="Exports" value={poll.settings?.allow_exports !== false ? 'Allowed' : 'Disabled'} />
```

Defaults matter: `public`, `allow_close`, `allow_exports` default to `true`
when absent (see `pollManagement.ts:587-590`), so use `!== false`, not
truthiness. `min_votes`/`max_votes` default to 1.

### Step 3: Fix the roles and weights blocks

Still in `PollCard.tsx`:

1. Allowed Roles block (line ~113): prefer names from `role_metadata` when
   present, falling back to the raw ID:
   ```tsx
   const roleName = (id: string) => poll.settings?.role_metadata?.[id]?.name ?? id;
   ```
   Render `poll.settings.allowed_roles.map(roleName).join(', ')` instead of
   joining raw IDs. Keep "All Users" for the empty case.
2. Vote Weights block (line ~116): change `poll.settings?.weights` to
   `poll.settings?.vote_weights` (both the condition and the mapped entries),
   and display role names via the same `roleName` helper.

**Verify**: `cd dashboard && npx tsc -b --noEmit` → exit 0. `npm run build` → exit 0.

## Test plan

No dashboard test harness exists; rely on:

- Typecheck/build gates above.
- Manual smoke test (optional, if a dev environment is running): open the
  admin Polls page, expand a poll created with non-default settings
  (e.g. `public: false`, `max_votes: 3`, one allowed role) and confirm the
  panel reflects them.

## Done criteria

- [ ] `cd dashboard && npx tsc -b --noEmit` exits 0
- [ ] `cd dashboard && npm run build` exits 0
- [ ] `grep -n "allow_multivote\|hide_results\|settings?.private\|settings?.weights" dashboard/src -r` → no matches
- [ ] `grep -c "vote_weights" dashboard/src/components/PollCard.tsx` ≥ 1
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Step 1's typecheck failure includes files other than `PollCard.tsx` — some
  other component consumes the legacy fields and needs its own assessment.
- `role_metadata` turns out to be absent on most real polls AND the allowed-roles
  display becomes unreadable ID soup — report; a backend enrichment would be
  out of scope.
- The `PollCard.tsx` excerpt doesn't match (drift).

## Maintenance notes

- Plan 004 (UI primitives) will restyle this card; landing this correctness
  fix first means the restyle doesn't carry the bug forward.
- Reviewer should check the default-handling (`!== false`) against
  `pollManagement.ts:585-595` — displaying "No" for an absent-but-default-true
  setting would be a new lie.
- Deferred: unifying this card with the inline PollCard in
  `UserServerView.tsx` (tracked as debt in `plans/README.md`).
