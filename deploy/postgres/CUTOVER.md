# PostgreSQL cutover and rollback

Use this runbook after installing the same source version on the target host.
Keep `data/user` and the PostgreSQL table-owner credentials outside the Web
process. The target is the existing `deeptutor-mcp-postgres` container. Use a
clean database in it for the final import; the local rehearsal uses
`deeptutor_prod` and keeps the test-populated `deeptutor` database separate.
Create a new dump and snapshot at the actual cutover time.

## Freeze and back up

1. Stop the Web/API, CLI, partner, cron and other local SQLite writers. Check
   the process list and prevent new requests while taking the snapshot.
2. Copy every SQLite database with SQLite's backup API and run
   `PRAGMA integrity_check` on each copy. Keep the source tree read-only for
   rollback. Record SHA-256 and table counts in a private manifest.
3. Take a PostgreSQL custom-format dump with `pg_dump -Fc` using the
   migration role; validate its catalog with `pg_restore -l`. Store it with
   mode 0600 away from the application process.

## Import and associate owners

Create an empty database owned by the migration role. Run Alembic against
that database first, then apply `init/01_app_role.sql` and
`roles/02_auth_role.sql` to **that same database**, in that order. Both scripts
grant `CONNECT` on the database to which `psql` is connected. Keep the
test-populated development database out of the deployment dump; the local
rehearsal found more than two thousand integration-test user rows there.
The runtime `DATABASE_URL` and `AUTH_DATABASE_URL` must name the clean database.
Web, CLI and SDK startup now check `alembic_version` through the data role and
refuse to start unless it matches the schema revision expected by this source
version. Run Alembic before switching the deployment selectors; do not grant
the runtime role migration privileges to work around a version mismatch.

PostgreSQL mode currently supports moving a text-only conversation between
workspaces. The Settings → Data migration bundle preview, export, move and
recovery controls are disabled because their transaction and rollback logic
still targets separate SQLite databases. Conversations linked to Mastery data,
attachments or answer images cannot be moved between workspaces in this mode.
Plan workspace ownership before the import; do not use the legacy SQLite
bundle workflow after switching the backend.

With the same owner IDs used during
the candidate import, rerun the SQLite importer against the frozen copy:

```bash
DATABASE_URL="$MIGRATION_DATABASE_URL" python -m scripts.migration.sqlite_to_postgres.migrate \
  --home /private/snapshot/user --owner legacy_62ec318f44ec9004 \
  --cron-db /private/snapshot/cron/jobs.sqlite3 \
  --web-source-db /private/snapshot/system/web-source-sync.sqlite \
  --execute --check
```

Import any second local account tree under its own owner ID. Do not merge
two trees merely because one was nested inside the other. The current
`data/user/data/user` tree has one failed turn, no messages and no file-backed
content. It is preserved as a separate diagnostic owner with no login.

Run a strict key-field comparison after the import, using the migration URL:

```bash
DATABASE_URL="$MIGRATION_DATABASE_URL" python -m scripts.migration.sqlite_to_postgres.verify \
  --home /private/snapshot/user --owner legacy_62ec318f44ec9004
DATABASE_URL="$MIGRATION_DATABASE_URL" python -m scripts.migration.sqlite_to_postgres.verify \
  --home /private/snapshot/user/data/user --owner legacy_254982f6a4beb9b1
```

The verifier compares session titles, message roles and content, turn status,
all event keys and metadata, Mastery revisions/payloads, and LLM call payloads.
It fails if any source key is missing, extra, or changed in PostgreSQL.
Run migration and claim checks with the table-owner connection; run Web,
CLI, SDK and runtime-isolation checks with the restricted data/auth role pair.
The importer needs to create owner and subscription rows and cannot run under
the RLS-restricted application role.

If the main owner has not already been claimed, use the offline account claim
command in [roles/README.md](roles/README.md). The development database has
already claimed `legacy_62ec318f44ec9004` as `imported_local`; a new server
restored from its dump retains that account and its password hash.

Copy the workspace and presentation files using the hash-checking command in
[roles/README.md](roles/README.md). Keep its manifest with the database dump.
The old default workspace's presentation alias is imported into the new
owner's PostgreSQL catalog; historical file URLs rely on both the alias and
the copied blobs. Copy document bytes separately from the database dump.

## Verify before opening traffic

Use `deeptutor_app` for `DATABASE_URL` and `deeptutor_auth` for
`AUTH_DATABASE_URL`. Set `DEEPTUTOR_STORAGE_BACKEND=postgres`,
`DEEPTUTOR_ACCOUNT_BACKEND=postgres`, and `AUTH_ENABLED=true`. Configure
`AUTH_USERNAME` and `AUTH_PASSWORD_HASH` for the deployment-selected
super administrator; its account lives in `admin_accounts`, apart from
ordinary users. Keep the JWT secret, database passwords and bootstrap hash
in the deployment secret manager.

Start the API on a private staging port. Confirm:

- `/health` succeeds, ordinary login reads the migrated sessions and an
  administrator signs in through `/api/auth/admin/login`;
- a second ordinary user cannot read the imported sessions or files;
- a real WebSocket turn completes, its messages appear in PostgreSQL, and
  they survive a process restart;
- Mastery and assessment reads/writes work for the same owner, including
  recovery of an interrupted turn and pending linked assessment;
- source SQLite hashes remain unchanged and no new local SQLite file appears;
- all source counts and key fields reconcile with PostgreSQL, including
  attachments and copied-file SHA-256 values.

For a source installation, the same selectors and connection URLs must be in
the launcher process environment when starting the full Web/API application.
For example, load the deployment secret manager's exported values without
printing them, then run:

```bash
deeptutor start --home /srv/deeptutor --detach --no-browser
```

Check both the backend health endpoint and the frontend login page through
the deployment's private ingress. A detached launcher inherits its startup
environment; a later shell export does not change the running services. Stop
that launcher with `deeptutor stop --home /srv/deeptutor` before changing the
backend selectors or restoring a dump. The local development rehearsal used
`--dev`; omit it for a production frontend build.

Only then route public traffic to the PostgreSQL-mode process. Preserve the
frozen SQLite tree and the pre-cutover PostgreSQL dump until the rollback
window is closed.

## Roll back

Stop PostgreSQL-mode writers and remove public traffic. Restore the saved
PostgreSQL dump to a **new temporary database first**, verify its schema,
account rows and representative session/Mastery counts, then decide whether
the live PostgreSQL database must be replaced. Restore role setup and secrets
separately; a database dump does not contain role passwords. Restore the
frozen `data/user` tree and run the local backend (`DEEPTUTOR_STORAGE_BACKEND=local`,
`DEEPTUTOR_ACCOUNT_BACKEND=local`) only after accounting for any new turns
written during the PostgreSQL window. Those new turns are not present in the
frozen SQLite snapshot and require an export or an explicit data-loss decision.

The development restore rehearsal used a disposable PostgreSQL database,
validated 89 imported sessions, 63,353 turn events, two Mastery paths, the
claimed ordinary credential and one super administrator, then dropped that
temporary database. It did not replace the live database or switch a cloud
server.
