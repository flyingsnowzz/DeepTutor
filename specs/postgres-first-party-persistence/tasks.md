# PostgreSQL first-party persistence tasks

- [x] Inventory every first-party account, session, Mastery, and assessment writer; document the exact local tables and files to migrate.
- [x] Define a common storage interface and wire a single deployment-mode selector at startup.
- [x] Add additive Alembic tables/columns for administrator credentials, Mastery parity, leases, and assessment evidence, with owner-scoped constraints.
- [x] Implement PostgreSQL account and administrator flows using the existing separate login entry points and deployment super administrator bootstrap.
- [x] Implement PostgreSQL Mastery transactions and interaction/event semantics; test concurrent revisions, leases, and cross-owner access.
- [x] Implement PostgreSQL assessment writes and linked Mastery updates with atomicity or durable retry.
- [x] Implement an idempotent local-to-PostgreSQL importer with account ID mapping and conflict report.
- [x] Route Web/API, CLI, SDK, and capabilities through the selected backend; reject mixed writers in PostgreSQL mode.
- [x] Verify representative user journeys, migration counts, isolation, restart persistence, and failure behavior against a real PostgreSQL instance.
- [x] Update deployment and recovery documentation after end-to-end verification.

Local acceptance used the clean `deeptutor_prod` database in the existing
`deeptutor-mcp-postgres` container. The user deferred cloud deployment;
`deploy/postgres/CUTOVER.md` is the runbook for that later operation. Evidence,
test results and known feature limitations are recorded in `cutover-status.md`.
