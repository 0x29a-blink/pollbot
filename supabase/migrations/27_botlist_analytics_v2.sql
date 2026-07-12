-- Expanded bot-list voter analytics for the dashboard's Voter Analytics hub
-- and per-poll supporter detail cards.
--
-- All three functions return per-user data or admin-grade aggregates, so they
-- are service_role-only and reached exclusively through the authenticated
-- admin API. Per migration 26: REVOKE must name anon/authenticated explicitly
-- (hosted Supabase default-grants EXECUTE on new functions to both).

-- ---------------------------------------------------------------------------
-- 1. One-call analytics bundle: history, hourly/weekday patterns, new vs
--    returning voters, platform overlap, weekend share, campaign sources.
--    p_source filters to one list ('topgg'/'discordforge'); NULL = both.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_botlist_analytics(p_days INT DEFAULT 30, p_source TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
WITH bounds AS (
    SELECT LEAST(GREATEST(p_days, 1), 365) AS n
),
window_start AS (
    SELECT (CURRENT_DATE - ((SELECT n FROM bounds) - 1))::timestamptz AS ts
),
f AS (
    SELECT bv.*
    FROM botlist_votes bv
    WHERE NOT bv.is_test
      AND bv.created_at >= (SELECT ts FROM window_start)
      AND (p_source IS NULL OR bv.source = p_source)
),
days AS (
    SELECT generate_series(
        CURRENT_DATE - ((SELECT n FROM bounds) - 1),
        CURRENT_DATE,
        '1 day'
    )::date AS day
),
history AS (
    SELECT d.day, s.source, COALESCE(v.votes, 0) AS votes, COALESCE(v.unique_voters, 0) AS unique_voters
    FROM days d
    CROSS JOIN (SELECT unnest(ARRAY['topgg', 'discordforge']) AS source) s
    LEFT JOIN (
        SELECT created_at::date AS day, source,
               COUNT(*)::INT AS votes,
               COUNT(DISTINCT user_id)::INT AS unique_voters
        FROM f GROUP BY 1, 2
    ) v ON v.day = d.day AND v.source = s.source
    ORDER BY d.day, s.source
),
hours AS (
    SELECT h.hour, COALESCE(v.votes, 0) AS votes
    FROM generate_series(0, 23) AS h(hour)
    LEFT JOIN (
        SELECT EXTRACT(HOUR FROM created_at)::INT AS hour, COUNT(*)::INT AS votes
        FROM f GROUP BY 1
    ) v USING (hour)
    ORDER BY h.hour
),
weekdays AS (
    -- ISO: 1 = Monday ... 7 = Sunday
    SELECT wd.dow, COALESCE(v.votes, 0) AS votes
    FROM generate_series(1, 7) AS wd(dow)
    LEFT JOIN (
        SELECT EXTRACT(ISODOW FROM created_at)::INT AS dow, COUNT(*)::INT AS votes
        FROM f GROUP BY 1
    ) v USING (dow)
    ORDER BY wd.dow
),
firsts AS (
    SELECT user_id, MIN(created_at) AS first_at
    FROM botlist_votes WHERE NOT is_test GROUP BY user_id
),
new_returning AS (
    SELECT d.day,
           COUNT(DISTINCT vf.user_id) FILTER (WHERE fs.first_at::date = d.day)::INT AS new_voters,
           COUNT(DISTINCT vf.user_id) FILTER (WHERE fs.first_at::date < d.day)::INT AS returning_voters
    FROM days d
    LEFT JOIN f vf ON vf.created_at::date = d.day
    LEFT JOIN firsts fs ON fs.user_id = vf.user_id
    GROUP BY d.day
    ORDER BY d.day
),
overlap AS (
    -- Which lists each in-window voter used (source filter ignored on purpose)
    SELECT COUNT(*) FILTER (WHERE srcs = ARRAY['topgg'])::INT AS topgg_only,
           COUNT(*) FILTER (WHERE srcs = ARRAY['discordforge'])::INT AS discordforge_only,
           COUNT(*) FILTER (WHERE cardinality(srcs) = 2)::INT AS both
    FROM (
        SELECT user_id, ARRAY_AGG(DISTINCT source ORDER BY source) AS srcs
        FROM botlist_votes
        WHERE NOT is_test AND created_at >= (SELECT ts FROM window_start)
        GROUP BY user_id
    ) x
),
weekend AS (
    SELECT COUNT(*) FILTER (WHERE is_weekend IS TRUE)::INT AS weekend_votes,
           COUNT(*)::INT AS total_votes
    FROM f
),
campaigns AS (
    SELECT query->>'source' AS campaign, COUNT(*)::INT AS votes
    FROM f
    WHERE query ? 'source'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10
)
SELECT jsonb_build_object(
    'days',          (SELECT n FROM bounds),
    'history',       (SELECT COALESCE(jsonb_agg(to_jsonb(h)), '[]'::jsonb) FROM history h),
    'hours',         (SELECT COALESCE(jsonb_agg(to_jsonb(h)), '[]'::jsonb) FROM hours h),
    'weekdays',      (SELECT COALESCE(jsonb_agg(to_jsonb(w)), '[]'::jsonb) FROM weekdays w),
    'new_returning', (SELECT COALESCE(jsonb_agg(to_jsonb(nr)), '[]'::jsonb) FROM new_returning nr),
    'overlap',       (SELECT to_jsonb(o) FROM overlap o),
    'weekend',       (SELECT to_jsonb(w) FROM weekend w),
    'campaigns',     (SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM campaigns c)
);
$$;

REVOKE ALL ON FUNCTION get_botlist_analytics(INT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_botlist_analytics(INT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Voter directory: searchable, sortable, paginated per-voter stats,
--    including the voter's current daily vote streak and the latest weekly/
--    total counters DiscordForge reports. Returns {total, rows}.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_botlist_voter_directory(
    p_days INT DEFAULT 30,
    p_source TEXT DEFAULT NULL,
    p_search TEXT DEFAULT NULL,
    p_sort TEXT DEFAULT 'votes',
    p_limit INT DEFAULT 25,
    p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
WITH bounds AS (
    SELECT LEAST(GREATEST(p_days, 1), 365) AS n
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
-- Current streak: consecutive UTC days with >=1 vote (any source, all time),
-- counted back from each user's most recent vote day. Classic prefix trick:
-- ordered desc, a row belongs to the streak iff day = last_day - (rn - 1).
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
           (u.last_vote_at > NOW() - INTERVAL '13 hours') IS TRUE AS premium_active
    FROM agg a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN streaks s ON s.user_id = a.user_id
    WHERE p_search IS NULL OR p_search = ''
       OR a.user_id LIKE p_search || '%'
       OR COALESCE(u.username, a.bl_username) ILIKE '%' || p_search || '%'
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

REVOKE ALL ON FUNCTION get_botlist_voter_directory(INT, TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_botlist_voter_directory(INT, TEXT, TEXT, TEXT, INT, INT) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Per-poll supporter card: how a poll's voters relate to the bot lists —
--    premium-now count, supporters per list, and the top bot-list supporters
--    among the poll's voters.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_botlist_poll_supporters(p_poll_id TEXT)
RETURNS JSONB
LANGUAGE SQL STABLE SECURITY DEFINER AS $$
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
                       WHERE u.last_vote_at > NOW() - INTERVAL '13 hours'),
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

REVOKE ALL ON FUNCTION get_botlist_poll_supporters(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_botlist_poll_supporters(TEXT) TO service_role;
