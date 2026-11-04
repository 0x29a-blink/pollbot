-- 31_dashboard_accuracy.sql
--
-- MANUAL MIGRATION: this project does not use the Supabase CLI migration
-- history locally. Apply via Supabase SQL editor or MCP apply_migration (it is
-- idempotent and safe to re-run), then verify the lock-down with e.g.
--   SELECT has_function_privilege('anon', 'public.get_guild_browser(text,text,boolean,int,int)', 'EXECUTE');
-- which must return false for every function below.
--
-- Accurate numbers for the redesigned dashboard:
-- 1. get_global_totals()        real platform totals (polls, active polls,
--                               ballots, vote_rows, weighted_votes, servers,
--                               members).
-- 2. get_guild_locale_counts()  servers per locale (current guilds only).
-- 3. get_top_creators_v2(INT)   returns creator_id, polls, username, avatar_url
--                               (keeps legacy get_top_creators(INT) intact).
-- 4. get_guild_browser(...)     server-side search/sort/paginate over current
--                               guilds with per-guild poll + vote aggregates.
--                               Cross-server vote_count / votes_desc sort uses
--                               raw option votes (matching get_top_guilds and
--                               get_vote_history) so a single guild's custom
--                               role multiplier cannot skew global rankings.
-- 5. Guild analytics RPCs no longer inflate on multi-select polls (one vote
--    row per chosen option):
--      get_guild_top_voters    votes = DISTINCT polls voted in
--      get_guild_vote_activity votes = ballots (DISTINCT poll_id,user_id), zero-filled days
--      get_guild_peak_hours    votes = ballots per hour, zero-filled 0..23
--    Names, params and column names are unchanged.
--
-- Every function: SECURITY DEFINER, STABLE, search_path pinned, EXECUTE for
-- service_role only (FROM PUBLIC alone is not enough on hosted Supabase).

-- ----------------------------------------------------------------------------
-- 1. get_global_totals
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_global_totals()
RETURNS TABLE(
    total_polls BIGINT,
    active_polls BIGINT,
    ballots BIGINT,
    vote_rows BIGINT,
    weighted_votes BIGINT,
    servers BIGINT,
    members BIGINT
)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT
        (SELECT COUNT(*) FROM polls)::BIGINT,
        (SELECT COUNT(*) FROM polls po WHERE po.active)::BIGINT,
        -- One ballot per (poll, user); GROUP BY can walk the votes PK index.
        (SELECT COUNT(*) FROM (SELECT 1 FROM votes vb GROUP BY vb.poll_id, vb.user_id) b)::BIGINT,
        (SELECT COUNT(*) FROM votes)::BIGINT,
        (SELECT COALESCE(SUM(CASE WHEN vw.weight > 0 THEN vw.weight ELSE 1 END), 0) FROM votes vw)::BIGINT,
        g.servers,
        g.members
    FROM (
        SELECT COUNT(*)::BIGINT AS servers,
               COALESCE(SUM(gg.member_count), 0)::BIGINT AS members
        FROM guilds gg
        WHERE gg.left_at IS NULL
    ) g;
$$;

REVOKE ALL ON FUNCTION public.get_global_totals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_global_totals() TO service_role;

-- ----------------------------------------------------------------------------
-- 2. get_guild_locale_counts
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_guild_locale_counts()
RETURNS TABLE(locale TEXT, servers BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE(g.locale, 'unknown') AS locale,
           COUNT(*)::BIGINT AS servers
    FROM guilds g
    WHERE g.left_at IS NULL
    GROUP BY 1
    ORDER BY 2 DESC, 1;
$$;

REVOKE ALL ON FUNCTION public.get_guild_locale_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_guild_locale_counts() TO service_role;

-- ----------------------------------------------------------------------------
-- 3. get_top_creators_v2 (adds username, avatar_url alongside legacy RPC)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_top_creators_v2(p_limit INT DEFAULT 5)
RETURNS TABLE(creator_id TEXT, polls BIGINT, username TEXT, avatar_url TEXT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT c.creator_id, c.polls, u.username, u.avatar_url
    FROM (
        SELECT po.creator_id, COUNT(*)::BIGINT AS polls
        FROM polls po
        WHERE po.creator_id IS NOT NULL
        GROUP BY po.creator_id
        ORDER BY 2 DESC, 1
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 25)
    ) c
    LEFT JOIN users u ON u.id = c.creator_id
    ORDER BY c.polls DESC, c.creator_id;
$$;

REVOKE ALL ON FUNCTION public.get_top_creators_v2(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_creators_v2(INT) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. get_guild_browser
-- ----------------------------------------------------------------------------
-- Sorts: members_desc (default / unknown values), members_asc, recent
-- (joined_at desc), polls_desc, votes_desc, engagement_desc (votes per poll),
-- activity_desc (latest poll first). Ties break on id.
-- p_search is a case-insensitive substring match via strpos(), so %, _ and \
-- in user input are literal (no LIKE escaping needed).
-- Cross-guild vote_count uses raw vote rows (matching get_top_guilds) so a
-- server with huge custom role weights cannot distort cross-server rankings.
CREATE OR REPLACE FUNCTION public.get_guild_browser(
    p_search TEXT DEFAULT NULL,
    p_sort TEXT DEFAULT 'members_desc',
    p_curated BOOLEAN DEFAULT FALSE,
    p_offset INT DEFAULT 0,
    p_limit INT DEFAULT 24
)
RETURNS TABLE(
    id TEXT,
    name TEXT,
    icon_url TEXT,
    member_count INTEGER,
    joined_at TIMESTAMPTZ,
    locale TEXT,
    poll_count BIGINT,
    active_poll_count BIGINT,
    vote_count BIGINT,
    weighted_votes BIGINT,
    last_poll_at TIMESTAMPTZ,
    total_count BIGINT
)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
    WITH params AS (
        SELECT lower(NULLIF(btrim(p_search), '')) AS search,
               COALESCE(p_sort, 'members_desc') AS sort,
               COALESCE(p_curated, FALSE) AS curated,
               GREATEST(COALESCE(p_offset, 0), 0) AS off,
               LEAST(GREATEST(COALESCE(p_limit, 24), 1), 100) AS lim
    ),
    ag AS (
        SELECT g.id, g.name, g.icon_url, g.member_count, g.joined_at, g.locale
        FROM guilds g, params pr
        WHERE g.left_at IS NULL
          AND (pr.search IS NULL OR strpos(lower(g.name), pr.search) > 0)
    ),
    pa AS (
        SELECT po.guild_id,
               COUNT(*)::BIGINT AS poll_count,
               COUNT(*) FILTER (WHERE po.active)::BIGINT AS active_poll_count,
               MAX(po.created_at) AS last_poll_at
        FROM polls po
        WHERE po.guild_id IN (SELECT ag.id FROM ag)
        GROUP BY po.guild_id
    ),
    va_all AS (
        SELECT po.guild_id,
               COUNT(*)::BIGINT AS vote_count
        FROM votes v
        JOIN polls po ON po.message_id = v.poll_id
        WHERE COALESCE(p_sort, '') IN ('votes_desc', 'engagement_desc')
        GROUP BY po.guild_id
    ),
    base AS (
        SELECT ag.id, ag.name, ag.icon_url, ag.member_count, ag.joined_at, ag.locale,
               COALESCE(pa.poll_count, 0)::BIGINT AS poll_count,
               COALESCE(pa.active_poll_count, 0)::BIGINT AS active_poll_count,
               COALESCE(va_all.vote_count, 0)::BIGINT AS sort_votes,
               pa.last_poll_at
        FROM ag
        CROSS JOIN params pr
        LEFT JOIN pa ON pa.guild_id = ag.id
        LEFT JOIN va_all ON va_all.guild_id = ag.id
        WHERE NOT pr.curated OR COALESCE(pa.poll_count, 0) > 0
    ),
    ranked AS (
        SELECT b.*,
               COUNT(*) OVER () AS total_count,
               ROW_NUMBER() OVER (
                   ORDER BY
                       CASE WHEN pr.sort = 'members_asc' THEN b.member_count END ASC NULLS LAST,
                       CASE WHEN pr.sort = 'recent' THEN b.joined_at END DESC NULLS LAST,
                       CASE WHEN pr.sort = 'polls_desc' THEN b.poll_count END DESC,
                       CASE WHEN pr.sort = 'votes_desc' THEN b.sort_votes END DESC,
                       CASE WHEN pr.sort = 'engagement_desc'
                            THEN b.sort_votes::NUMERIC / NULLIF(b.poll_count, 0) END DESC NULLS LAST,
                       CASE WHEN pr.sort = 'activity_desc' THEN b.last_poll_at END DESC NULLS LAST,
                       CASE WHEN pr.sort NOT IN ('members_asc', 'recent', 'polls_desc', 'votes_desc',
                                                 'engagement_desc', 'activity_desc')
                            THEN b.member_count END DESC NULLS LAST,
                       b.id
               ) AS rn
        FROM base b
        CROSS JOIN params pr
    ),
    page AS (
        SELECT r.*
        FROM ranked r, params pr
        WHERE r.rn > pr.off AND r.rn <= pr.off + pr.lim
    ),
    va_page AS (
        SELECT po.guild_id,
               COUNT(*)::BIGINT AS vote_count,
               SUM(CASE WHEN v.weight > 0 THEN v.weight ELSE 1 END)::BIGINT AS weighted_votes
        FROM page pg
        JOIN polls po ON po.guild_id = pg.id
        JOIN votes v ON v.poll_id = po.message_id
        GROUP BY po.guild_id
    )
    SELECT pg.id, pg.name, pg.icon_url, pg.member_count, pg.joined_at, pg.locale,
           pg.poll_count, pg.active_poll_count,
           COALESCE(va_page.vote_count, 0)::BIGINT AS vote_count,
           COALESCE(va_page.weighted_votes, 0)::BIGINT AS weighted_votes,
           pg.last_poll_at,
           pg.total_count::BIGINT
    FROM page pg
    LEFT JOIN va_page ON va_page.guild_id = pg.id
    ORDER BY pg.rn;
$$;

REVOKE ALL ON FUNCTION public.get_guild_browser(TEXT, TEXT, BOOLEAN, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_guild_browser(TEXT, TEXT, BOOLEAN, INT, INT) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Guild analytics: count ballots / polls, not per-option rows
-- ----------------------------------------------------------------------------
-- votes = number of DISTINCT polls the user voted in during the window.
CREATE OR REPLACE FUNCTION public.get_guild_top_voters(p_guild_id TEXT, p_days INT DEFAULT 30, p_limit INT DEFAULT 10)
RETURNS TABLE(user_id TEXT, votes BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT v.user_id, COUNT(DISTINCT v.poll_id)::BIGINT
    FROM votes v JOIN polls p ON v.poll_id = p.message_id
    WHERE p.guild_id = p_guild_id
      AND v.created_at > NOW() - make_interval(days => LEAST(GREATEST(p_days, 1), 365))
    GROUP BY 1
    ORDER BY 2 DESC, 1
    LIMIT LEAST(GREATEST(p_limit, 1), 25);
$$;

REVOKE ALL ON FUNCTION public.get_guild_top_voters(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_guild_top_voters(TEXT, INT, INT) TO service_role;

-- votes = ballots (DISTINCT poll_id, user_id) per day; every day in the window
-- is present (zero-filled), matching get_vote_history.
CREATE OR REPLACE FUNCTION public.get_guild_vote_activity(p_guild_id TEXT, p_days INT DEFAULT 30)
RETURNS TABLE(day DATE, votes BIGINT, unique_voters BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
    WITH bounds AS (
        SELECT LEAST(GREATEST(COALESCE(p_days, 30), 1), 365) AS n
    ),
    days AS (
        SELECT generate_series(
            CURRENT_DATE - ((SELECT n FROM bounds) - 1),
            CURRENT_DATE,
            '1 day'
        )::date AS day
    ),
    v AS (
        SELECT vt.created_at::date AS day,
               COUNT(DISTINCT (vt.poll_id, vt.user_id))::BIGINT AS votes,
               COUNT(DISTINCT vt.user_id)::BIGINT AS unique_voters
        FROM votes vt
        JOIN polls p ON vt.poll_id = p.message_id
        WHERE p.guild_id = p_guild_id
          AND vt.created_at >= CURRENT_DATE - ((SELECT n FROM bounds) - 1)
        GROUP BY 1
    )
    SELECT d.day, COALESCE(v.votes, 0)::BIGINT, COALESCE(v.unique_voters, 0)::BIGINT
    FROM days d
    LEFT JOIN v USING (day)
    ORDER BY d.day;
$$;

REVOKE ALL ON FUNCTION public.get_guild_vote_activity(TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_guild_vote_activity(TEXT, INT) TO service_role;

-- votes = ballots per hour of day (UTC), all 24 hours present.
CREATE OR REPLACE FUNCTION public.get_guild_peak_hours(p_guild_id TEXT, p_days INT DEFAULT 30)
RETURNS TABLE(hour INT, votes BIGINT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
    WITH hours AS (
        SELECT generate_series(0, 23) AS hour
    ),
    v AS (
        SELECT EXTRACT(HOUR FROM vt.created_at)::INT AS hour,
               COUNT(DISTINCT (vt.poll_id, vt.user_id))::BIGINT AS votes
        FROM votes vt
        JOIN polls p ON vt.poll_id = p.message_id
        WHERE p.guild_id = p_guild_id
          AND vt.created_at > NOW() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 30), 1), 365))
        GROUP BY 1
    )
    SELECT h.hour, COALESCE(v.votes, 0)::BIGINT
    FROM hours h
    LEFT JOIN v USING (hour)
    ORDER BY h.hour;
$$;

REVOKE ALL ON FUNCTION public.get_guild_peak_hours(TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_guild_peak_hours(TEXT, INT) TO service_role;
