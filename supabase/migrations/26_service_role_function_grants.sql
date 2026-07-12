-- Hosted Supabase sets ALTER DEFAULT PRIVILEGES so every new function in
-- public is executable by anon and authenticated DIRECTLY — not via PUBLIC.
-- REVOKE ... FROM PUBLIC therefore does not lock a function down in
-- production (it does on a default local stack, which is why this slipped
-- through review). Explicitly revoke anon/authenticated from every function
-- that is meant to be service_role-only.
--
-- Verified in production 2026-07-12: before this migration all five functions
-- were anon-executable. The four SECURITY DEFINER analytics functions leaked
-- per-user rows to the anon key; replace_vote is SECURITY INVOKER so RLS
-- still blocked anon writes, but it is tightened here for defense in depth.

REVOKE ALL ON FUNCTION get_top_botlist_voters(INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_guild_vote_activity(TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_guild_peak_hours(TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_guild_top_voters(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION replace_vote(TEXT, TEXT, INTEGER[], INTEGER) FROM PUBLIC, anon, authenticated;

-- The bot reaches all of these with the service key.
GRANT EXECUTE ON FUNCTION get_top_botlist_voters(INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION get_guild_vote_activity(TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION get_guild_peak_hours(TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION get_guild_top_voters(TEXT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION replace_vote(TEXT, TEXT, INTEGER[], INTEGER) TO service_role;
