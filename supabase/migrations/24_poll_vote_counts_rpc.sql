-- Batch vote counts for poll list views, returned as a single JSONB value:
-- { "<poll_id>": { "<option_index>": count, ... }, ... }
--
-- Replaces selecting raw vote rows with .in('poll_id', ids), which silently
-- truncates at PostgREST's 1000-row response cap once a batch of polls holds
-- more than 1000 votes. Aggregate counts only — no user ids leave the DB.
CREATE OR REPLACE FUNCTION get_poll_vote_counts(p_poll_ids TEXT[])
RETURNS JSONB
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
    SELECT COALESCE(jsonb_object_agg(per_poll.poll_id, per_poll.counts), '{}'::jsonb)
    FROM (
        SELECT c.poll_id, jsonb_object_agg(c.option_index::text, c.cnt) AS counts
        FROM (
            -- [1:200] bounds the work per call; callers page in far smaller batches
            SELECT v.poll_id, v.option_index, COUNT(*)::INT AS cnt
            FROM votes v
            WHERE v.poll_id = ANY(p_poll_ids[1:200])
            GROUP BY 1, 2
        ) c
        GROUP BY c.poll_id
    ) per_poll;
$$;

REVOKE ALL ON FUNCTION get_poll_vote_counts(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_poll_vote_counts(TEXT[]) TO anon, authenticated, service_role;
