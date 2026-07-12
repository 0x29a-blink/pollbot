-- Pin search_path on every RPC the Supabase security advisor flags as
-- "Function Search Path Mutable". Most are SECURITY DEFINER, where an
-- unpinned search_path is a privilege-escalation vector if an attacker can
-- create objects in a schema that resolves earlier in the path.
--
-- ALTER FUNCTION ... SET is deliberately used instead of re-CREATE: it pins
-- the config while leaving bodies, ownership, and the GRANT/REVOKE posture
-- (several functions are service_role-only per migration 26) untouched.
-- schema.sql mirrors this by adding SET search_path = public to each
-- definition for fresh installs. The trigger functions
-- (update_global_poll_count / update_global_vote_count) were already pinned.

ALTER FUNCTION get_total_members() SET search_path = public;
ALTER FUNCTION bump_peak_active_servers(INT) SET search_path = public;
ALTER FUNCTION replace_vote(TEXT, TEXT, INTEGER[], INTEGER) SET search_path = public;
ALTER FUNCTION get_active_voter_count() SET search_path = public;
ALTER FUNCTION get_guild_vote_counts() SET search_path = public;
ALTER FUNCTION get_usage_summary(INT) SET search_path = public;
ALTER FUNCTION get_guild_vote_activity(TEXT, INT) SET search_path = public;
ALTER FUNCTION get_guild_peak_hours(TEXT, INT) SET search_path = public;
ALTER FUNCTION get_guild_top_voters(TEXT, INT, INT) SET search_path = public;
ALTER FUNCTION get_vote_history(INT) SET search_path = public;
ALTER FUNCTION get_global_peak_hours(INT) SET search_path = public;
ALTER FUNCTION get_top_guilds(INT, INT) SET search_path = public;
ALTER FUNCTION get_top_creators(INT) SET search_path = public;
ALTER FUNCTION get_poll_vote_counts(TEXT[]) SET search_path = public;
ALTER FUNCTION get_botlist_vote_history(INT) SET search_path = public;
ALTER FUNCTION get_botlist_vote_totals() SET search_path = public;
ALTER FUNCTION get_top_botlist_voters(INT, INT) SET search_path = public;
ALTER FUNCTION get_botlist_analytics(INT, TEXT) SET search_path = public;
ALTER FUNCTION get_botlist_voter_directory(INT, TEXT, TEXT, TEXT, INT, INT) SET search_path = public;
ALTER FUNCTION get_botlist_poll_supporters(TEXT) SET search_path = public;
