#!/usr/bin/env python3
"""Copy and hash-check file-backed content for a claimed SQLite owner.

Only the ordinary user's workspace files and immutable presentation snapshots
are copied. SQLite databases, journals and migration locks stay in the
original frozen source for rollback; runtime settings and provider secrets are
not copied into the new ordinary-user account.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile


CONTENT_DIRS = (Path("workspace"), Path(".runtime/workspace_presentations"))
EXCLUDED_SUFFIXES = (".db", ".sqlite", ".sqlite3", ".db-wal", ".db-shm",
                     ".sqlite-wal", ".sqlite-shm", ".sqlite3-wal", ".sqlite3-shm",
                     ".lock")


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def copy_content(source_home: Path, target_home: Path, *, execute: bool) -> list[dict]:
    source_home = source_home.resolve()
    target_home = target_home.resolve()
    if source_home == target_home or source_home in target_home.parents or target_home in source_home.parents:
        raise ValueError("Source and destination homes must be separate")
    records: list[dict] = []
    for relative_dir in CONTENT_DIRS:
        source_dir = source_home / relative_dir
        if not source_dir.exists():
            continue
        if source_dir.is_symlink():
            raise ValueError(f"Content source contains a symlink: {source_dir}")
        for source in sorted(source_dir.rglob("*")):
            if source.is_symlink():
                raise ValueError(f"Content source contains a symlink: {source}")
            if not source.is_file() or source.name.endswith(EXCLUDED_SUFFIXES):
                continue
            relative = source.relative_to(source_home)
            target = target_home / relative
            cursor = target
            while cursor != target_home:
                if cursor.is_symlink():
                    raise ValueError(f"Content target contains a symlink: {cursor}")
                cursor = cursor.parent
            checksum = digest(source)
            if target.exists() and (not target.is_file() or digest(target) != checksum):
                raise ValueError(f"Target content conflicts with source: {target}")
            if execute and not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".copy-", delete=False) as tmp:
                    temporary = Path(tmp.name)
                try:
                    shutil.copy2(source, temporary)
                    if digest(temporary) != checksum:
                        raise RuntimeError(f"Copied content hash mismatch: {relative}")
                    os.replace(temporary, target)
                finally:
                    temporary.unlink(missing_ok=True)
            if execute and digest(target) != checksum:
                raise RuntimeError(f"Target content hash mismatch: {relative}")
            records.append({"path": relative.as_posix(), "size": source.stat().st_size,
                            "sha256": checksum})
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-home", type=Path, required=True)
    parser.add_argument("--target-home", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    records = copy_content(args.source_home, args.target_home, execute=args.execute)
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(records, ensure_ascii=False, indent=2))
    os.chmod(args.manifest, 0o600)
    print(f"{'copied' if args.execute else 'checked'} {len(records)} files, "
          f"{sum(record['size'] for record in records)} bytes")


if __name__ == "__main__":
    main()
