-- Restricted application role for production.
-- The table-owning role (migrations / local dev) bypasses RLS; this role does
-- not own any table, so the owner_isolation policies always apply to it.
-- Application transactions must run: SET LOCAL app.user_id = '<user_id>';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deeptutor_app') THEN
    CREATE ROLE deeptutor_app LOGIN PASSWORD 'replace-in-secret-manager';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE deeptutor TO deeptutor_app;
GRANT USAGE ON SCHEMA public TO deeptutor_app;
-- Table/sequence DML grants are also issued by Alembic migration 0003 when
-- this role exists; the statements below make a fresh image immediately usable.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO deeptutor_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO deeptutor_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO deeptutor_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO deeptutor_app;
