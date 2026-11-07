#!/usr/bin/env python3
"""Give an imported legacy PostgreSQL owner a first-party learner login.

The imported owner ID stays unchanged, preserving every existing foreign key
and all migration receipts. Run only with the PostgreSQL migration/table-owner
role, after a validated backup and while Web writers are stopped.
"""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
import stat
import sys
import uuid

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from deeptutor.services.accounts.first_party import FirstPartyAccountService
from deeptutor.services.auth.security import hash_password
from deeptutor.services.postgres.database import create_engine, database_url


async def claim(owner: str, username: str, password: str | None = None) -> str:
    """Check or claim an uncredentialed imported owner in one transaction."""
    if not owner.startswith("legacy_"):
        raise ValueError("Owner must be an imported legacy_ user ID")
    username = FirstPartyAccountService._username(username)
    engine = create_engine(database_url())
    try:
        async with engine.begin() as db:
            row = (await db.execute(text(
                "SELECT id,username,role,is_active FROM users WHERE id=:owner FOR UPDATE"
            ), {"owner": owner})).mappings().first()
            if row is None or not row["is_active"] or row["role"] != "user":
                raise ValueError("Imported ordinary user does not exist or is inactive")
            receipt = (await db.execute(text(
                "SELECT 1 FROM migration_batches WHERE owner_user_id=:owner LIMIT 1"
            ), {"owner": owner})).scalar_one_or_none()
            if receipt is None:
                raise ValueError("No SQLite migration receipt exists for this owner")
            credential = (await db.execute(text(
                "SELECT 1 FROM first_party_credentials WHERE owner_user_id=:owner"
            ), {"owner": owner})).scalar_one_or_none()
            if credential is not None or row["username"]:
                raise ValueError("Imported owner is already claimed or has a username")
            existing = (await db.execute(text(
                "SELECT 1 FROM users WHERE lower(username)=lower(:username) LIMIT 1"
            ), {"username": username})).scalar_one_or_none()
            if existing is not None:
                raise ValueError("Username already exists")
            if password is None:
                return "ready"
            if len(password) < 8:
                raise ValueError("Password must contain at least 8 characters")
            await db.execute(text(
                "UPDATE users SET username=:username,"
                "display_name=COALESCE(NULLIF(display_name,''),:display_name),"
                "updated_at=now() WHERE id=:owner"
            ), {"username": username, "display_name": username, "owner": owner})
            await db.execute(text(
                "INSERT INTO first_party_credentials(owner_user_id,password_hash) "
                "VALUES (:owner,:hash)"
            ), {"owner": owner, "hash": hash_password(password)})
            await db.execute(text(
                "INSERT INTO auth_identities(id,owner_user_id,provider,subject) "
                "VALUES (:id,:owner,'first_party_username',:subject)"
            ), {
                "id": f"ai_{uuid.uuid4().hex}", "owner": owner,
                "subject": username.lower(),
            })
            await db.execute(text(
                "INSERT INTO subscriptions(owner_user_id) VALUES (:owner) "
                "ON CONFLICT(owner_user_id) DO NOTHING"
            ), {"owner": owner})
        return "claimed"
    except IntegrityError as exc:
        raise ValueError("Username or imported account changed concurrently") from exc
    finally:
        await engine.dispose()


def _password_file(path: Path) -> str:
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o077:
        raise ValueError("Password file must not be readable by group or others")
    password = path.read_text(encoding="utf-8").rstrip("\r\n")
    if len(password) < 8:
        raise ValueError("Password must contain at least 8 characters")
    return password


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", required=True, help="Imported legacy_ owner ID")
    parser.add_argument("--username", required=True, help="New ordinary-user login name")
    parser.add_argument("--execute", action="store_true", help="Commit the account claim")
    parser.add_argument("--password-file", type=Path, help="Mode-0600 password file for --execute")
    args = parser.parse_args()
    if args.execute and args.password_file is None:
        parser.error("--execute requires --password-file")
    if not args.execute and args.password_file is not None:
        parser.error("--password-file is only used with --execute")
    try:
        password = _password_file(args.password_file) if args.execute else None
        result = asyncio.run(claim(args.owner, args.username, password))
    except (ValueError, OSError) as exc:
        print(f"claim failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    print(f"{result}: {args.owner} -> {args.username}")


if __name__ == "__main__":
    main()
