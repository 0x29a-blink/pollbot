-- 32_discordforge_v2_and_vote_stacking.sql
--
-- MANUAL MIGRATION: apply via Supabase SQL editor or MCP apply_migration (idempotent
-- and safe to re-run), then verify lock-down with:
--   SELECT has_function_privilege('anon', 'public.record_botlist_vote(text,text,text,text,text,int,boolean,boolean,int,int,int,jsonb)', 'EXECUTE');
-- which must return false.
--
-- What this adds:
-- 1. DiscordForge Webhooks v2 & Top.gg v1 idempotency (`botlist_votes.event_id` +
--    partial unique index on `(source, event_id)` where non-null) plus `streak`
--    captured from DiscordForge v2 `vote.created` payloads.
-- 2. Stacked vote-time windows (`users.premium_expires_at`):
--    - Voting from an expired/new state grants 12h + 1h buffer (13h total).
--    - Voting on a second bot list (or again while active) stacks +12h onto the
--      active `premium_expires_at` window instead of overwriting `last_vote_at`.
-- 3. `record_botlist_vote(...)` service_role-only RPC that atomically deduplicates
--    retried webhook deliveries and stacks `premium_expires_at` without race conditions.
-- 4. Updates `get_active_voter_count`, `get_botlist_voter_directory`, and
--    `get_botlist_poll_supporters` to honor `premium_expires_at` (with fallback to
--    `last_vote_at + 13h` for legacy rows).

ALTER TABLE public.botlist_votes
    ADD COLUMN IF NOT EXISTS event_id TEXT,
    ADD COLUMN IF NOT EXISTS streak INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_botlist_votes_source_event_id
    ON public.botlist_votes(source, event_id)
    WHERE event_id IS NOT NULL;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS premium_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.users.premium_expires_at IS
    'Stacked vote-reward expiry. First vote grants NOW() + 13h; voting while active adds +12h.';

UPDATE public.users
SET premium_expires_at = last_vote_at + INTERVAL '13 hours'
WHERE premium_expires_at IS NULL
  AND last_vote_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_premium_expires_at
    ON public.users(premium_expires_at DESC)
    WHERE premium_expires_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 1. Atomic vote recording + idempotency + time stacking
-- ----------------------------------------------------------------------------
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
BEGIN
    INSERT INTO public.botlist_votes (
        source, user_id, event_id, username, avatar_url,
        weight, is_test, is_weekend, weekly_votes, total_votes, streak, query
    )
    VALUES (
        p_source,
        p_user_id,
        NULLIF(btrim(p_event_id), ''),
        NULLIF(btrim(p_username), ''),
        NULLIF(btrim(p_avatar_url), ''),
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

    -- Retried webhook delivery for an already-handled event: do not double-count
    -- in analytics and do not double-stack premium time.
    IF v_inserted_id IS NULL THEN
        RETURN jsonb_build_object('duplicate', TRUE, 'is_test', COALESCE(p_is_test, FALSE), 'premium_expires_at', NULL);
    END IF;

    -- Test deliveries are stored for diagnostics but never grant premium time.
    IF COALESCE(p_is_test, FALSE) THEN
        RETURN jsonb_build_object('duplicate', FALSE, 'is_test', TRUE, 'premium_expires_at', NULL);
    END IF;

    INSERT INTO public.users (id, last_vote_at, premium_expires_at, username, avatar_url)
    VALUES (
        p_user_id,
        NOW(),
        NOW() + INTERVAL '13 hours',
        NULLIF(btrim(p_username), ''),
        NULLIF(btrim(p_avatar_url), '')
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

-- ----------------------------------------------------------------------------
-- 2. Update active-premium checks across RPCs to honor stacked premium_expires_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_active_voter_count()
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COUNT(*)::BIGINT
    FROM public.users
    WHERE COALESCE(premium_expires_at, last_vote_at + INTERVAL '13 hours') > NOW();
$$;

REVOKE ALL ON FUNCTION public.get_active_voter_count() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_voter_count() TO service_role;

CREATE OR REPLACE FUNCTION public.get_botlist_voter_directory(
    p_days INT DEFAULT 30,
    p_source TEXT DEFAULT NULL,
    p_search TEXT DEFAULT NULL,
    p_sort TEXT DEFAULT 'votes',
    p_limit INT DEFAULT 25,
    p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
WITH bounds AS (
    SELECT LEAST(GREATEST(p_days, 1), 365) AS n
),
escaped_search AS (
    SELECT CASE
        WHEN p_search IS NULL OR p_search = '' THEN NULL
        ELSE replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_')
    END AS pat
),
f AS (
    SELECT bv.*
    FROM botlist_votes bv
    WHERE NOT bv.is_test
      AND bv.created_at >= (CURRENT_DATE - ((SELECT n FROM bounds) - 1))::timestamptz
      AND (p_source IS NULL OR bv.source = p_source)
),
agg AS (
    SELECT user_id,
           COUNT(*)::INT AS votes,
           SUM(weight)::INT AS weighted_votes,
           ARRAY_AGG(DISTINCT source ORDER BY source) AS sources,
           MIN(created_at) AS first_vote_at,
           MAX(created_at) AS last_botlist_vote_at,
           MAX(username) FILTER (WHERE username IS NOT NULL) AS bl_username,
           MAX(avatar_url) FILTER (WHERE avatar_url IS NOT NULL) AS bl_avatar_url,
           (ARRAY_AGG(weekly_votes ORDER BY created_at DESC) FILTER (WHERE weekly_votes IS NOT NULL))[1] AS df_weekly_votes,
           (ARRAY_AGG(total_votes ORDER BY created_at DESC) FILTER (WHERE total_votes IS NOT NULL))[1] AS df_total_votes
    FROM f
    GROUP BY user_id
),
streaks AS (
    SELECT user_id, COUNT(*)::INT AS streak_days
    FROM (
        SELECT user_id, day,
               MAX(day) OVER (PARTITION BY user_id) AS last_day,
               ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY day DESC) AS rn
        FROM (SELECT DISTINCT user_id, created_at::date AS day FROM botlist_votes WHERE NOT is_test) d
    ) x
    WHERE day = last_day - (rn - 1)::INT
    GROUP BY user_id
),
enriched AS (
    SELECT a.user_id,
           COALESCE(u.username, a.bl_username) AS username,
           COALESCE(u.avatar_url, a.bl_avatar_url) AS avatar_url,
           a.votes, a.weighted_votes, a.sources,
           a.first_vote_at, a.last_botlist_vote_at,
           a.df_weekly_votes, a.df_total_votes,
           COALESCE(s.streak_days, 0) AS streak_days,
           u.last_vote_at AS premium_last_vote_at,
           u.premium_expires_at AS premium_expires_at,
           (COALESCE(u.premium_expires_at, u.last_vote_at + INTERVAL '13 hours') > NOW()) IS TRUE AS premium_active
    FROM agg a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN streaks s ON s.user_id = a.user_id
    CROSS JOIN escaped_search es
    WHERE es.pat IS NULL
       OR a.user_id LIKE es.pat || '%' ESCAPE '\'
       OR COALESCE(u.username, a.bl_username) ILIKE '%' || es.pat || '%' ESCAPE '\'
),
sorted AS (
    SELECT * FROM enriched
    ORDER BY
        CASE WHEN p_sort = 'votes'  THEN votes END DESC NULLS LAST,
        CASE WHEN p_sort = 'streak' THEN streak_days END DESC NULLS LAST,
        CASE WHEN p_sort = 'weighted' THEN weighted_votes END DESC NULLS LAST,
        last_botlist_vote_at DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
    OFFSET GREATEST(p_offset, 0)
)
SELECT jsonb_build_object(
    'total', (SELECT COUNT(*) FROM enriched),
    'rows',  (SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb) FROM sorted s)
);
$$;

REVOKE ALL ON FUNCTION public.get_botlist_voter_directory(INT, TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_botlist_voter_directory(INT, TEXT, TEXT, TEXT, INT, INT) TO service_role;

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
           MAX(bv.created_at) AS last_botlist_vote_at
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
                                 u.username,
                                 u.avatar_url,
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
