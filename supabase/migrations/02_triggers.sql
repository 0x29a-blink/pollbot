-- 02_triggers.sql
-- Triggers for automatic global_stats updates
-- Fixed: Added explicit search_path to prevent security warnings

-- Function for poll count (with fixed search_path)
CREATE OR REPLACE FUNCTION update_global_poll_count()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE global_stats
    SET total_polls = total_polls + 1,
        last_updated = NOW()
    WHERE id = 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_global_poll_count ON polls;
CREATE TRIGGER trg_update_global_poll_count
AFTER INSERT ON polls
FOR EACH ROW
EXECUTE FUNCTION update_global_poll_count();

-- Function for vote count (with fixed search_path)
CREATE OR REPLACE FUNCTION update_global_vote_count()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE global_stats
    SET total_votes = total_votes + 1,
        last_updated = NOW()
    WHERE id = 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_global_vote_count ON votes;
CREATE TRIGGER trg_update_global_vote_count
AFTER INSERT ON votes
FOR EACH ROW
EXECUTE FUNCTION update_global_vote_count();
