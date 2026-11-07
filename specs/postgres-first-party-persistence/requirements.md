# PostgreSQL first-party persistence requirements

## Scope

Move first-party account identity, Mastery Path aggregates, interactions, events, and assessment evidence to PostgreSQL for a multi-user server deployment. Keep local SQLite as the default for single-user installations. Do not place document binaries, knowledge-base indexes, cache files, or provider credentials in PostgreSQL.

## Acceptance criteria

1. WHEN a deployment selects PostgreSQL mode, THE SYSTEM SHALL use one stable `owner_user_id` for registration, login, Mastery Path reads and writes, and assessment evidence.
2. WHEN an ordinary user registers or logs in, THE SYSTEM SHALL persist credentials and sessions in PostgreSQL and SHALL prevent another user from reading or changing that user's data.
3. WHEN an administrator logs in, THE SYSTEM SHALL use a separate login entry and credential store. THE SYSTEM SHALL create the initial super administrator only from deployment configuration; only that super administrator may create other administrators.
4. WHEN a Mastery Path changes, THE SYSTEM SHALL atomically persist its revision, interactions, events, and lease state with the same conflict and idempotency behavior as the current `LearningStore`.
5. WHEN assessment evidence is recorded, THE SYSTEM SHALL associate it with the same owner and session identity and update linked Mastery state atomically or with a recoverable outbox.
6. WHEN existing local data is imported, THE SYSTEM SHALL preserve IDs, owner mapping, timestamps, and evidence; rerunning import SHALL be idempotent and report conflicts.
7. WHEN PostgreSQL is unavailable in PostgreSQL mode, THE SYSTEM SHALL fail closed and report a storage error; it SHALL NOT silently write to local SQLite.
8. WHEN local mode is selected, THE SYSTEM SHALL retain the current SQLite behavior.
9. WHEN migration is cut over, THE SYSTEM SHALL provide a backup, count comparison, owner isolation checks, and a rollback procedure before accepting live traffic.

## Out of scope

Knowledge graph nodes and edges, search indexes, document binaries, and a blanket migration of all runtime settings and artifacts.
