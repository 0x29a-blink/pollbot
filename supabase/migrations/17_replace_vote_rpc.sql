-- Migration 17: Atomic vote replacement
--
-- Replaces a user's votes on a poll in a single transaction so a failed insert
-- can never leave the user with zero recorded votes (previously the bot did a
-- separate DELETE then INSERT, and an insert failure erased the prior vote).
--
-- The function body runs atomically: if the INSERT violates the polls foreign
-- key (poll deleted), the whole statement rolls back, including the DELETE, and
-- the error surfaces to the caller as SQLSTATE 23503.

CREATE OR REPLACE FUNCTION replace_vote(
    p_poll_id TEXT,
    p_user_id TEXT,
    p_options INTEGER[],
    p_weight INTEGER
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM votes WHERE poll_id = p_poll_id AND user_id = p_user_id;

    INSERT INTO votes (poll_id, user_id, option_index, weight)
    SELECT p_poll_id, p_user_id, opt, p_weight
    FROM unnest(p_options) AS opt;
END;
$$;

-- Only the bot (service_role) may replace votes. Explicitly revoke the default
-- PUBLIC execute grant so the anon key cannot stuff arbitrary votes.
REVOKE ALL ON FUNCTION replace_vote(TEXT, TEXT, INTEGER[], INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION replace_vote(TEXT, TEXT, INTEGER[], INTEGER) TO service_role;
