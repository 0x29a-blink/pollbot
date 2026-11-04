# Contributing to Simple Poll Bot

Thank you for your interest in contributing to **Simple Poll Bot** by **Simple Solutions™**! Community bug fixes, improvements, and translations are welcome.

## Repository Licensing

This repository uses a split-directory licensing structure:

- **Core Bot & Backend (`src/`, `schema.sql`, `scripts/`, `supabase/`)**: Licensed under the [MIT License](LICENSE).
- **Web Dashboard (`dashboard/`)**: Source-available under the [PolyForm Shield License 1.0.0](dashboard/LICENSE) (see also [`dashboard/NOTICE`](dashboard/NOTICE)). You may inspect, modify, contribute to, and privately self-host the dashboard for non-competing purposes, but you may not use it to offer a competing public bot or hosted dashboard service.
- **Trademarks & Branding**: **Simple Solutions™**, **Simple Poll Bot**, `pollbot.win`, and all official logos and brand assets remain the exclusive property of **Simple Solutions™**.

## Development & Pre-PR Checks

1. Always test against an isolated development bot and test server (`DEV_ONLY_MODE=true` and `DEV_GUILD_ID` in `.env`) — never against production.
2. Before opening a pull request, ensure all checks pass cleanly:

```bash
# Backend checks
npm run typecheck
npm test
npm run lint
npm run build

# Dashboard checks
cd dashboard && npx tsc -b --noEmit && npm run build
```

3. If your change alters the database schema, add a numbered SQL migration in `supabase/migrations/` **and** mirror the update into `schema.sql`.

## Contributor License Agreement (CLA)

By submitting a pull request, commit, patch, or other contribution ("Contribution") to this repository, you represent and agree that:

1. **Originality & Authority**: The Contribution is your original creation (or you have the legal right and authority to submit it) and does not knowingly infringe any third-party intellectual property rights.
2. **License Grant to Simple Solutions™**: You grant **Simple Solutions™** (and its successors, affiliates, and assigns) a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright and patent license to use, reproduce, modify, prepare derivative works of, publicly display, publicly perform, sublicense, relicense, and distribute your Contribution and any derivative works — both under this repository's open-source / source-available licenses and within any official hosted or commercial services operated by **Simple Solutions™**.
3. **No Obligation**: You retain copyright in your own original work (subject to the grant above) and provide your Contribution "AS IS" without warranties or support obligations.
