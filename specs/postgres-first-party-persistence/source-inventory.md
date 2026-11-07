# Local source inventory for the PostgreSQL cutover

The frozen local candidate is `.local/cutover-candidate-20261107/manifest.json`.
It records SQLite backup hashes and table counts for 17 databases. The
original default account tree is `data/user`; the accidentally nested
`data/user/data/user` tree is a separate diagnostic owner. Their PostgreSQL
IDs are `legacy_62ec318f44ec9004` and `legacy_254982f6a4beb9b1`.

| Local source | First-party records | PostgreSQL destination |
| --- | --- | --- |
| `data/user/settings/auth.json` or deployment `AUTH_USERNAME`/`AUTH_PASSWORD_HASH` | Local bootstrap identity, if configured | One deployment-selected `admin_accounts` superadmin; the hash is supplied by the deployment secret manager |
| `data/system/auth/users.json`, `data/system/auth/admins.json`, and legacy `data/user/auth_users.json` | Ordinary and delegated administrator account metadata | `users`, `first_party_credentials`, `admin_accounts`, `user_grants`; deployment superadmin comes from a secret-backed bootstrap configuration |
| `data/system/auth/device_credentials.json` | Learner device credentials | `device_credential_state` and the owner-scoped MarginNote 4 device index |
| `data/user/chat_history.db` and nested counterpart | `sessions`, `messages`, `turns`, `turn_submissions`, `turn_events` | Same named owner-scoped tables |
| Same chat databases | `notebook_entries`, categories, category links, assessment attempts, practice state/events/imports, reading quiz pending/rewards | `assessment_cards`, `assessment_attempts`, `notebook_categories`, `notebook_entry_categories`, `notebook_practice_*`, `reading_quiz_*` |
| `data/user/workspace/learning/mastery/mastery.sqlite3` | Paths, path-session links, interactions, events, evidence, leases, topic metadata/sources, reading progress/activity | Owner-scoped `mastery_*` and `reading_learning_*` tables |
| `data/user/usage.sqlite3` | `llm_calls` | `llm_call_ledger` |
| `data/user/.runtime/calendar/calendar.sqlite` | Calendar state, calendars, events, undo | `calendar_states` |
| `data/user/.runtime/workspaces.sqlite3` and nested counterpart | Workspace registry and metadata | `workspace_catalog_states` |
| `data/user/workspace/reading/_catalog.sqlite3` | Materials, reading workspaces, links and sessions | `reading_catalog_states` |
| `data/user/workspace/library/library.db` | File metadata | `library_files_pg`; document bytes remain files |
| `data/cron/jobs.sqlite3` | Scheduled jobs | `scheduled_jobs`, `scheduled_jobs_meta` |
| `data/system/web-source-sync.sqlite` | Web source scheduler state | `web_source_sync_state` |
| `data/partners/_runtime/status.sqlite3` | Partner runtime status | `partner_runtime_status` |

The candidate also contains three workspace-activity lock databases and
generated workspace catalogs under `data/users/`; these are empty or local
runtime scaffolding, not an additional account's learning history. The
four local account/device JSON files listed above were absent from this
candidate, so there were no pre-existing ordinary or delegated credentials
to import from them. The
candidate's two local account trees were imported and reconciled separately.
The main account was claimed as `imported_local`; the diagnostic owner has no
login. A deployment-selected `admin` account was bootstrapped in
`admin_accounts`, separate from ordinary credentials.

Document binaries, knowledge-base indexes, caches, provider secrets and
general runtime settings are outside this persistence migration. The
hash-checked content copy placed 975 file-backed objects (5,563,173 bytes)
in the imported owner's home so historical URLs remain accessible. Full
workspace bundle transfer is a separate feature and remains disabled in
PostgreSQL mode; the account/session/Mastery/assessment storage cutover does
not depend on it.

The importer is `scripts/migration/sqlite_to_postgres/migrate.py`; the strict
read-only key-field comparison is `scripts/migration/sqlite_to_postgres/verify.py`.
`deploy/postgres/CUTOVER.md` gives the freeze, import, verification and
rollback procedure. Local acceptance evidence is recorded in
`cutover-status.md`.
