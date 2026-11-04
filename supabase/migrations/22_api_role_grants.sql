-- Restore table/sequence grants for Supabase API roles.
-- Newer local Postgres images set postgres default privileges in public to
-- only Dxtm (truncate/refs/trigger/maintain), so migration-created tables
-- lack SELECT/INSERT/UPDATE/DELETE for anon/authenticated/service_role.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
