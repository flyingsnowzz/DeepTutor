# PostgreSQL first-party persistence design

## Current boundary

The Web/API Mastery routes instantiate `LearningStore` directly, and assessment recording explicitly opens the SQLite session store. The PostgreSQL `PostgresMasteryRepository` is a separate, narrower MCP-facing implementation. `DATABASE_URL` alone does not redirect the first-party routes. Local auth and the PostgreSQL AuthService also have distinct account stores and token formats.

## Target boundary

Introduce a single deployment storage-mode selector at application startup. Resolve one first-party identity before opening user-scoped repositories. Both local and PostgreSQL implementations must expose the same application-facing account, session, Mastery, and assessment operations; routers and capabilities should depend on those operations rather than construct storage classes directly. Keep administrator identity separate from ordinary users while mapping both to explicit authorization principals.

The PostgreSQL schema needs parity with the local Mastery model: aggregate JSON plus revision, interaction lifecycle fields, ordered events, path mutation leases, previews, reading records, and assessment/evidence links. Every user-owned row has `owner_user_id`; queries and uniqueness constraints include owner scope. A lease and aggregate revision update share a transaction. Assessment write and Mastery update either share that transaction or use an outbox with a durable retry key.

## Migration and cutover

1. Inventory all SQLite tables and file-backed account records used by first-party flows; freeze a source snapshot.
2. Create additive PostgreSQL migrations and repository parity tests. Do not repurpose the existing simplified `mastery_paths.state_json` without a data conversion.
3. Import accounts with a stable local-ID-to-PostgreSQL-ID mapping, then sessions, paths, interactions, events, and assessment evidence. Preserve source IDs where possible and record import provenance.
4. Run count, checksum, ownership, and representative replay checks. Cut over all first-party writers together after verification. Roll back to the frozen local snapshot only before new PostgreSQL writes; after that, use forward repair or an explicit reverse migration.

## Deployment rule

Local remains the default. PostgreSQL mode requires a valid connection and current Alembic revision at startup. No per-request fallback or dual authoritative store. File assets and indexes remain on durable shared storage or object storage; PostgreSQL stores their metadata and ownership references.
