-- 1. Missing indexes for foreign keys and high-frequency query paths
-- 2. Optimize get_top_guilds to pre-aggregate votes per poll via idx_votes_created_poll
-- 3. Fix weighted vote aggregation in get_poll_vote_counts and get_guild_vote_counts
--    so admin poll/server views match aggregateVoteRows() in src/lib/voteUtils.ts
-- 4. Escape LIKE/ILIKE wildcards (%, _, \) in get_botlist_voter_directory search
-- 5. Restrict supabase_realtime publication strictly to global_stats
-- 6. Defense-in-depth table grants: anon/authenticated only need SELECT on global_stats

CREATE INDEX IF NOT EXISTS idx_polls_guild_created
    ON public.polls(guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_polls_creator_id
    ON public.polls(creator_id)
    WHERE creator_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_polls_created_at
    ON public.polls(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_votes_created_poll
    ON public.votes(created_at DESC, poll_id);

CREATE INDEX IF NOT EXISTS idx_votes_user_created
    ON public.votes(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_last_vote_at
    ON public.users(last_vote_at DESC)
    WHERE last_vote_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_guilds_active_members
    ON public.guilds(member_count DESC)
    WHERE left_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_top_guilds(p_days INT DEFAULT 30, p_limit INT DEFAULT 5)
RETURNS TABLE(guild_id TEXT, guild_name TEXT, votes BIGINT, polls BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
    WITH poll_votes AS (
        SELECT v.poll_id,
               COUNT(*)::BIGINT AS vote_rows
        FROM votes v
        WHERE v.created_at > NOW() - make_interval(days => LEAST(GREATEST(p_days, 1), 365))
        GROUP BY v.poll_id
    ),
    guild_agg AS (
        SELECT p.guild_id,
               SUM(pv.vote_rows)::BIGINT AS votes,
               COUNT(*)::BIGINT AS polls
        FROM poll_votes pv
        JOIN polls p ON p.message_id = pv.poll_id
        GROUP BY p.guild_id
    )
    SELECT ga.guild_id,
           COALESCE(g.name, 'Unknown Server') AS guild_name,
           ga.votes,
           ga.polls
    FROM guild_agg ga
    LEFT JOIN guilds g ON g.id = ga.guild_id
    WHERE g.left_at IS NULL
    ORDER BY ga.votes DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 25);
$$;

REVOKE ALL ON FUNCTION public.get_top_guilds(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_guilds(INT, INT) TO service_role;

CREATE OR REPLACE FUNCTION public.get_poll_vote_counts(p_poll_ids TEXT[])
RETURNS JSONB
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(jsonb_object_agg(per_poll.poll_id, per_poll.counts), '{}'::jsonb)
    FROM (
        SELECT c.poll_id, jsonb_object_agg(c.option_index::text, c.cnt) AS counts
        FROM (
            SELECT v.poll_id,
                   v.option_index,
                   COALESCE(SUM(CASE WHEN v.weight > 0 THEN v.weight ELSE 1 END), 0)::INT AS cnt
            FROM votes v
            WHERE v.poll_id = ANY(p_poll_ids[1:200])
            GROUP BY 1, 2
        ) c
        GROUP BY c.poll_id
    ) per_poll;
$$;

REVOKE ALL ON FUNCTION public.get_poll_vote_counts(TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_poll_vote_counts(TEXT[]) TO service_role;

CREATE OR REPLACE FUNCTION public.get_guild_vote_counts()
RETURNS TABLE(guild_id TEXT, vote_count BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p.guild_id,
           COALESCE(SUM(CASE WHEN v.weight > 0 THEN v.weight ELSE 1 END), 0)::BIGINT AS vote_count
    FROM votes v
    JOIN polls p ON v.poll_id = p.message_id
    GROUP BY p.guild_id;
$$;

REVOKE ALL ON FUNCTION public.get_guild_vote_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_guild_vote_counts() TO service_role;

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
           (u.last_vote_at > NOW() - INTERVAL '13 hours') IS TRUE AS premium_active
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

-- Only global_stats is subscribed to via the public anon key (lightweight change signal).
ALTER PUBLICATION supabase_realtime SET TABLE public.global_stats;

-- Defense-in-depth table grants: revoke anon/authenticated on private tables
REVOKE ALL ON TABLE
    public.polls,
    public.votes,
    public.users,
    public.guilds,
    public.guild_settings,
    public.dashboard_sessions,
    public.usage_events,
    public.botlist_votes
FROM anon, authenticated;

REVOKE ALL ON TABLE public.global_stats FROM anon, authenticated;
GRANT SELECT ON TABLE public.global_stats TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
