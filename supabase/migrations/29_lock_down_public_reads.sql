-- Remove blanket public read access from every table holding per-user data,
-- and stop handing the admin telemetry RPCs to anon/authenticated.
--
-- Background: the dashboard gated its admin surfaces (global poll browser,
-- server browser, server detail, telemetry charts) only in React, via an
-- `is_admin` flag on the /api/auth/me response. The data behind those surfaces
-- was fetched straight from Supabase with the anon key -- which is public by
-- construction, since it ships inside the dashboard's JS bundle. Combined with
-- `FOR SELECT USING (true)` policies granted to PUBLIC, that made `votes`
-- (which Discord user voted for which option), `users` (Discord ids, usernames,
-- avatars), `polls` (question and option text from every server, including
-- private ones) and `guilds` readable by anyone with curl, logged in or not.
-- Hiding the UI never hid the data.
--
-- Admin reads now go through the backend's /api/admin/db proxy: it
-- authenticates the session cookie against DISCORD_ADMIN_IDS and only then
-- replays the query upstream with the service key.
--
-- NOTE: apply this only once a build carrying that proxy is deployed. Until
-- then the admin panel's reads will 401 against PostgREST.

-- ---------------------------------------------------------------------------
-- Table policies
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Public read access" ON users;
DROP POLICY IF EXISTS "Public read access" ON votes;
DROP POLICY IF EXISTS "Public read access" ON polls;

-- guilds / guild_settings accumulated two overlapping public-read policies.
DROP POLICY IF EXISTS "Public read access" ON guilds;
DROP POLICY IF EXISTS "Enable read access for all users" ON guilds;
DROP POLICY IF EXISTS "Public read access" ON guild_settings;
DROP POLICY IF EXISTS "Enable read access for all users" ON guild_settings;

-- `global_stats` deliberately keeps its public read policy: it is a single row
-- of aggregate counters with no per-user data, and the dashboard subscribes to
-- it as a lightweight "something changed" realtime signal.

-- ---------------------------------------------------------------------------
-- Function grants
--
-- These aggregate over users/votes/usage_events/botlist_votes. They are all
-- SECURITY DEFINER, so an EXECUTE grant to anon is a read grant on the
-- underlying tables regardless of the policies above. Reachable with the
-- service key only, i.e. through the authenticated admin API.
--
-- REVOKE FROM PUBLIC alone is not enough on hosted Supabase: default
-- privileges grant EXECUTE on new functions to anon/authenticated directly.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION get_active_voter_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_total_members() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_top_creators(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_top_guilds(INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_guild_vote_counts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_poll_vote_counts(TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_vote_history(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_global_peak_hours(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_usage_summary(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_botlist_vote_history(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_botlist_vote_totals() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION get_active_voter_count() TO service_role;
GRANT EXECUTE ON FUNCTION get_total_members() TO service_role;
GRANT EXECUTE ON FUNCTION get_top_creators(INT) TO service_role;
GRANT EXECUTE ON FUNCTION get_top_guilds(INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION get_guild_vote_counts() TO service_role;
GRANT EXECUTE ON FUNCTION get_poll_vote_counts(TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION get_vote_history(INT) TO service_role;
GRANT EXECUTE ON FUNCTION get_global_peak_hours(INT) TO service_role;
GRANT EXECUTE ON FUNCTION get_usage_summary(INT) TO service_role;
GRANT EXECUTE ON FUNCTION get_botlist_vote_history(INT) TO service_role;
GRANT EXECUTE ON FUNCTION get_botlist_vote_totals() TO service_role;

-- Counter maintenance. The trigger functions fire as the table owner, so
-- revoking direct EXECUTE does not affect the triggers themselves; it only
-- stops an anonymous caller invoking them over PostgREST.
REVOKE ALL ON FUNCTION bump_peak_active_servers(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION update_global_poll_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION update_global_vote_count() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION bump_peak_active_servers(INT) TO service_role;
GRANT EXECUTE ON FUNCTION update_global_poll_count() TO service_role;
GRANT EXECUTE ON FUNCTION update_global_vote_count() TO service_role;

-- ---------------------------------------------------------------------------
-- Verify (expect f for every anon/authenticated column):
--
--   SELECT c.relname,
--          has_table_privilege('anon', c.oid, 'SELECT') AS anon_select
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relkind = 'r';
--
--   SELECT p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.prokind = 'f';
--
-- has_table_privilege reports the GRANT, not the RLS policy, so `anon_select`
-- may still read true for tables; what matters is that no permissive SELECT
-- policy remains for PUBLIC. Confirm with:
--
--   SET LOCAL ROLE anon; SELECT count(*) FROM votes;   -- expect 0 rows
-- ---------------------------------------------------------------------------
