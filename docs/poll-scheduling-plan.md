# Poll Scheduling Implementation Plan

This document outlines the rough implementation plan for poll scheduling functionality.

---

## Feature Overview

Two scheduling capabilities are planned:

1. **Poll Auto-Close (`ends_at`)**: Automatically close a poll at a specified time
2. **Scheduled Start (`scheduled_start`)**: Create a poll that starts at a future time

### Database Schema (Already Prepared)

The following columns have been added to the `polls` table:

```sql
-- Already in migration 11_poll_scheduling.sql
ALTER TABLE polls ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ;

-- Partial indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_polls_ends_at ON polls(ends_at) 
WHERE ends_at IS NOT NULL AND active = true;

CREATE INDEX IF NOT EXISTS idx_polls_scheduled_start ON polls(scheduled_start) 
WHERE scheduled_start IS NOT NULL AND active = false;
```

---

## Auto-Close Implementation

### How It Works

1. **Poll Creation**: User optionally specifies a duration (e.g., "1 hour", "24 hours", "7 days")
2. **Storage**: Calculate `ends_at = now() + duration` and save to database
3. **Scheduler**: Background job checks for polls where `ends_at <= NOW() AND active = true`
4. **Action**: Close the poll, update Discord message, set `active = false`

### Scheduler Options

#### Option A: Internal Scheduler (Recommended)
Use a simple interval-based scheduler within the bot process:

```typescript
// src/services/PollSchedulerService.ts
import cron from 'node-cron';

class PollSchedulerService {
    start() {
        // Check every minute for polls that need to be closed
        cron.schedule('* * * * *', () => this.processExpiredPolls());
    }

    async processExpiredPolls() {
        const { data: expiredPolls } = await supabase
            .from('polls')
            .select('*')
            .lte('ends_at', new Date().toISOString())
            .eq('active', true);

        for (const poll of expiredPolls || []) {
            await this.closePoll(poll);
        }
    }
}
```

**Pros:**
- Simple to implement
- No external dependencies
- Works with sharding (only one process should run the scheduler)

**Cons:**
- Up to 1-minute delay before poll closes
- Must handle process restarts

#### Option B: External Scheduler (Supabase Cron/pg_cron)
Use Supabase's pg_cron extension or external scheduler like BullMQ.

### Discord Command Changes

Modify `/poll` command to accept optional `duration` parameter:

```typescript
.addStringOption(option =>
    option.setName('duration')
        .setDescription('Auto-close after this duration (e.g. "1h", "24h", "7d")')
        .setRequired(false))
```

### Dashboard Changes

- Add duration picker to poll creation form
- Show countdown timer on active polls
- Display "Closes at: {datetime}" on poll card

---

## Scheduled Start Implementation

### How It Works

1. **Poll Creation**: User specifies a start time in the future
2. **Storage**: Save with `active = false` and `scheduled_start` set
3. **Scheduler**: Background job checks for `scheduled_start <= NOW() AND active = false`
4. **Action**: Create the Discord message, set `active = true`

### Complexity Note

Scheduled starts are more complex because:
- The Discord message doesn't exist yet
- Need to store all poll data to recreate it
- Channel permissions might change between creation and start
- The bot might be removed from the server before start time

### Recommended Approach

For simplicity, start with **auto-close only**. Scheduled start can be added later.

---

## API Changes

### Poll Creation Endpoint

Add optional `ends_at` field:

```typescript
interface CreatePollRequest {
    // ... existing fields
    ends_at?: string; // ISO 8601 datetime or null
}
```

### Poll Response

Add scheduling info to poll responses:

```typescript
interface PollResponse {
    // ... existing fields
    ends_at: string | null;
    scheduled_start: string | null;
    time_remaining_seconds: number | null; // Computed field
}
```

---

## UI/UX Considerations

### Duration Input Options
- Dropdown: "1 hour", "6 hours", "12 hours", "24 hours", "48 hours", "7 days"
- Custom datetime picker for advanced users

### Visual Indicators
- Countdown timer on poll card
- "Auto-closes in X hours" badge
- Different styling for scheduled (not started) polls

### Notifications
- Optional DM to poll creator when poll auto-closes
- Webhook notification (future)

---

## Implementation Phases

### Phase 1: Auto-Close (MVP)
1. Add duration option to `/poll` command
2. Create `PollSchedulerService` with cron job
3. Update poll image to show "Closes in X" (optional)
4. Add duration picker to dashboard

### Phase 2: Scheduled Start
1. Add start time option to `/poll` command
2. Extend scheduler to handle starts
3. Handle edge cases (channel deleted, bot removed, etc.)
4. Dashboard UI for scheduled polls

### Phase 3: Enhancements
- Timezone handling for international users
- Recurring polls
- Poll templates with scheduling

---

## Estimated Effort

| Phase | Backend | Frontend | Total |
|-------|---------|----------|-------|
| Phase 1 | 4-6 hours | 2-4 hours | 6-10 hours |
| Phase 2 | 6-8 hours | 4-6 hours | 10-14 hours |
| Phase 3 | 8-12 hours | 6-10 hours | 14-22 hours |
