-- Add Foreign Key constraint to polls table to link guild_id to guilds.id
-- This allows us to use inner joins to find guilds that have polls
-- We use ON DELETE CASCADE so if a guild is deleted (unlikely via sync, but possible), its polls are cleaned up (or we could set null).
-- Given this is telemetry, CASCADE is likely fine or RESTRICT. Let's use CASCADE for cleanliness.

-- First, ensure all current guild_ids in polls exist in guilds to avoid violation?
-- If they don't, the constraint creation will fail.
-- In a real prod scenario we might need to insert placeholders, but for this dev setup we assume sync is good or we accept the failure/clean up.
-- Let's assume we can add the constraint.

ALTER TABLE polls 
ADD CONSTRAINT fk_polls_guild 
FOREIGN KEY (guild_id) 
REFERENCES guilds(id) 
ON DELETE CASCADE;
