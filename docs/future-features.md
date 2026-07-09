# Future Features Documentation

This document outlines planned features and their database/backend preparations.

---

## View All My Votes

### Overview
Allow users to view a list of all polls they have voted in across all servers.

### Database Preparation
A new index has been added to support efficient lookups:

```sql
CREATE INDEX IF NOT EXISTS idx_votes_user_id ON votes(user_id);
```

This index (added in migration `16_votes_user_index.sql`) enables efficient queries like:

```sql
SELECT v.*, p.title, p.guild_id, g.name as guild_name
FROM votes v
JOIN polls p ON v.poll_id = p.message_id
JOIN guilds g ON p.guild_id = g.id
WHERE v.user_id = 'DISCORD_USER_ID'
ORDER BY v.created_at DESC;
```

### Implementation Approach
1. **New API Endpoint:** `GET /api/user/votes`
   - Returns all polls the authenticated user has voted in
   - Includes vote timestamp, option chosen, and poll details
   - Paginated with limit/offset

2. **Dashboard Page:** `/my-votes`
   - Display votes grouped by server or chronologically
   - Link to the original poll (if user still has access)

3. **Required Permissions:**
   - User must be authenticated
   - Only shows votes from servers the bot is still in (due to FK constraint)

### Estimated Effort
- Backend: 2-4 hours
- Frontend: 4-6 hours

---

## Poll Scheduling

See [poll-scheduling-plan.md](./poll-scheduling-plan.md) for the detailed implementation plan.

---

## Vote Analytics (Premium Feature)

### Overview
Provide analytics on voting patterns within a server:
- Most active voters
- Peak voting times
- Vote distribution over time

### Database Requirements
The existing schema supports these queries via:
- `votes.created_at` - timestamp of each vote
- `polls.guild_id` - server context
- `votes.user_id` - voter identification

### Considerations
- Query performance with large datasets
- Privacy considerations for exposing voting patterns
- Premium gating strategy
