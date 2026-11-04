-- 33_botlist_voter_identity_enrichment.sql
--
-- MANUAL MIGRATION: apply via Supabase SQL editor or MCP apply_migration (idempotent
-- and safe to re-run), then verify lock-down with:
--   SELECT has_function_privilege('anon', 'public.record_botlist_vote(text,text,text,text,text,int,boolean,boolean,int,int,int,jsonb)', 'EXECUTE');
--   SELECT has_function_privilege('anon', 'public.get_botlist_poll_supporters(text)', 'EXECUTE');
-- which must both return false.
--
-- What this fixes:
-- 1. Backfills missing `username` and `avatar_url` on existing `botlist_votes` rows
--    from `public.users` (for voters who arrived via Top.gg legacy v0 or DiscordForge v2,
--    neither of which sends usernames in the webhook payload).
-- 2. Updates `record_botlist_vote` so any vote arriving without `p_username` / `p_avatar_url`
--    automatically inherits known identity fields from `public.users` on insert.
-- 3. Updates `get_botlist_poll_supporters` to COALESCE `users` and `botlist_votes`
--    usernames/avatars consistently with `get_top_botlist_voters` and `get_botlist_voter_directory`.

UPDATE public.botlist_votes bv
SET username = COALESCE(bv.username, u.username),
    avatar_url = COALESCE(bv.avatar_url, u.avatar_url)
FROM public.users u
WHERE bv.user_id = u.id
  AND (bv.username IS NULL OR bv.avatar_url IS NULL)
  AND (u.username IS NOT NULL OR u.avatar_url IS NOT NULL);

CREATE OR REPLACE FUNCTION public.record_botlist_vote(
    p_source TEXT,
    p_user_id TEXT,
    p_event_id TEXT DEFAULT NULL,
    p_username TEXT DEFAULT NULL,
    p_avatar_url TEXT DEFAULT NULL,
    p_weight INTEGER DEFAULT 1,
    p_is_test BOOLEAN DEFAULT FALSE,
    p_is_weekend BOOLEAN DEFAULT NULL,
    p_weekly_votes INTEGER DEFAULT NULL,
    p_total_votes INTEGER DEFAULT NULL,
    p_streak INTEGER DEFAULT NULL,
    p_query JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inserted_id BIGINT;
    v_expires_at TIMESTAMPTZ;
    v_username TEXT := NULLIF(btrim(p_username), '');
    v_avatar_url TEXT := NULLIF(btrim(p_avatar_url), '');
BEGIN
    IF v_username IS NULL OR v_avatar_url IS NULL THEN
        SELECT COALESCE(v_username, u.username),
               COALESCE(v_avatar_url, u.avatar_url)
        INTO v_username, v_avatar_url
        FROM public.users u
        WHERE u.id = p_user_id;
    END IF;

    INSERT INTO public.botlist_votes (
        source, user_id, event_id, username, avatar_url,
        weight, is_test, is_weekend, weekly_votes, total_votes, streak, query
    )
    VALUES (
        p_source,
        p_user_id,
        NULLIF(btrim(p_event_id), ''),
        v_username,
        v_avatar_url,
        COALESCE(p_weight, 1),
        COALESCE(p_is_test, FALSE),
        p_is_weekend,
        p_weekly_votes,
        p_total_votes,
        p_streak,
        p_query
    )
    ON CONFLICT (source, event_id) WHERE event_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_inserted_id;

    IF v_inserted_id IS NULL THEN
        RETURN jsonb_build_object('duplicate', TRUE, 'is_test', COALESCE(p_is_test, FALSE), 'premium_expires_at', NULL);
    END IF;

    IF COALESCE(p_is_test, FALSE) THEN
        RETURN jsonb_build_object('duplicate', FALSE, 'is_test', TRUE, 'premium_expires_at', NULL);
    END IF;

    INSERT INTO public.users (id, last_vote_at, premium_expires_at, username, avatar_url)
    VALUES (
        p_user_id,
        NOW(),
        NOW() + INTERVAL '13 hours',
        v_username,
        v_avatar_url
    )
    ON CONFLICT (id) DO UPDATE SET
        last_vote_at = NOW(),
        premium_expires_at = GREATEST(
            COALESCE(users.premium_expires_at, users.last_vote_at + INTERVAL '13 hours'),
            NOW() + INTERVAL '1 hour'
        ) + INTERVAL '12 hours',
        username = COALESCE(EXCLUDED.username, users.username),
        avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url)
    RETURNING premium_expires_at INTO v_expires_at;

    RETURN jsonb_build_object('duplicate', FALSE, 'is_test', FALSE, 'premium_expires_at', v_expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.record_botlist_vote(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, BOOLEAN, BOOLEAN, INTEGER, INTEGER, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_botlist_vote(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, BOOLEAN, BOOLEAN, INTEGER, INTEGER, INTEGER, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.get_botlist_poll_supporters(p_poll_id TEXT)
RETURNS JSONB
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
WITH pv AS (
    SELECT DISTINCT user_id FROM votes WHERE poll_id = p_poll_id
),
bl AS (
    SELECT bv.user_id,
           ARRAY_AGG(DISTINCT bv.source ORDER BY bv.source) AS sources,
           COUNT(*)::INT AS botlist_votes,
           COUNT(*) FILTER (WHERE bv.created_at > NOW() - INTERVAL '30 days')::INT AS votes_30d,
           MAX(bv.created_at) AS last_botlist_vote_at,
           MAX(bv.username) FILTER (WHERE bv.username IS NOT NULL) AS bl_username,
           MAX(bv.avatar_url) FILTER (WHERE bv.avatar_url IS NOT NULL) AS bl_avatar_url
    FROM botlist_votes bv
    JOIN pv ON pv.user_id = bv.user_id
    WHERE NOT bv.is_test
    GROUP BY bv.user_id
)
SELECT jsonb_build_object(
    'total_voters',   (SELECT COUNT(*)::INT FROM pv),
    'premium_now',    (SELECT COUNT(*)::INT FROM pv JOIN users u ON u.id = pv.user_id
                       WHERE COALESCE(u.premium_expires_at, u.last_vote_at + INTERVAL '13 hours') > NOW()),
    'supporters',     (SELECT COUNT(*)::INT FROM bl),
    'supporters_30d', (SELECT COUNT(*)::INT FROM bl WHERE votes_30d > 0),
    'topgg',          (SELECT COUNT(*)::INT FROM bl WHERE 'topgg' = ANY(sources)),
    'discordforge',   (SELECT COUNT(*)::INT FROM bl WHERE 'discordforge' = ANY(sources)),
    'top_supporters', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
                          SELECT b.user_id,
                                 COALESCE(u.username, b.bl_username) AS username,
                                 COALESCE(u.avatar_url, b.bl_avatar_url) AS avatar_url,
                                 b.botlist_votes,
                                 b.sources,
                                 b.last_botlist_vote_at
                          FROM bl b
                          LEFT JOIN users u ON u.id = b.user_id
                          ORDER BY b.botlist_votes DESC
                          LIMIT 5
                      ) t)
);
$$;

REVOKE ALL ON FUNCTION public.get_botlist_poll_supporters(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_botlist_poll_supporters(TEXT) TO service_role;
