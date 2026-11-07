-- Dedicated credential role. Keep NOLOGIN until a deployment secret is set.
-- PostgreSQL BYPASSRLS is needed for username lookup before a user id exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deeptutor_auth') THEN
    CREATE ROLE deeptutor_auth NOLOGIN BYPASSRLS;
  END IF;
END
$$;

DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO deeptutor_auth', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO deeptutor_auth;
GRANT SELECT, INSERT, UPDATE ON users, subscriptions, auth_identities,
  first_party_credentials, admin_accounts, user_grants TO deeptutor_auth;
DO $$ BEGIN
  IF to_regclass('public.marginnote4_device_index') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE ON marginnote4_device_index TO deeptutor_auth;
    REVOKE ALL ON marginnote4_device_index FROM deeptutor_app;
  END IF;
END $$;

-- The learning-data role must never inspect or modify credential hashes.
REVOKE ALL ON admin_accounts, first_party_credentials FROM deeptutor_app;

-- Future tables receive explicit migration grants rather than blanket access.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM deeptutor_app;
