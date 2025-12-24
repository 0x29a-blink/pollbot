-- Create the votes table
-- Designed to support single vote per user per poll initially
-- But flexible enough to change PK or logic later for multi-select (which might use multiple rows or an array)
-- For true multi-select normalized: Use multiple rows (one per option selected).
-- So PK should be (poll_id, user_id, option_index) if allowing multiple.
-- But standard Discord polls are often radio buttons (Select Menu) or Checkboxes.
-- If Select Menu MaxValues > 1, we get multiple values in one interaction.
-- Let's store EACH selection as a row.

CREATE TABLE IF NOT EXISTS votes (
    poll_id TEXT NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    option_index INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (poll_id, user_id, option_index)
);

-- Index for faster count aggregation
CREATE INDEX IF NOT EXISTS idx_votes_poll_id ON votes(poll_id);
