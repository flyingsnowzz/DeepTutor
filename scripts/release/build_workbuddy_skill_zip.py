#!/usr/bin/env python3
"""Build a WorkBuddy skill submission zip after validation.

Bundles only the submission files (SKILL.md, README.md, references/, templates/,
examples/, listing/) — no scripts, caches, or runtime data. The validator must
pass before a zip is produced; `--force` skips validation for local iteration
only and prints a warning.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import zipfile

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from validate_workbuddy_skill import validate  # noqa: E402

INCLUDE_DIRS = {"references", "templates", "examples", "listing"}
INCLUDE_SUFFIXES = {".md", ".txt", ".json", ".yaml", ".yml", ".png", ".svg"}
EXCLUDE_PARTS = {"__pycache__", ".git", "node_modules", ".DS_Store"}


def build_zip(package_dir: Path, out_dir: Path, *, force: bool = False) -> Path:
    package_dir = package_dir.resolve()
    if not package_dir.is_dir():
        raise SystemExit(f"package directory not found: {package_dir}")

    report = validate(package_dir)
    if report.errors and not force:
        print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2))
        raise SystemExit("validation failed; zip not built (use --force for local-only builds)")
    if force and report.errors:
        print(f"WARNING: building despite {len(report.errors)} validation errors", file=sys.stderr)

    name = package_dir.name
    version = "0.0.0"
    skill_md = package_dir / "SKILL.md"
    if skill_md.is_file():
        for line in skill_md.read_text(encoding="utf-8").splitlines():
            if line.startswith("version:"):
                version = line.split(":", 1)[1].strip().strip("\"'")
                break

    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"{name}-{version}.zip"
    files = [package_dir / "SKILL.md"]
    if (package_dir / "README.md").is_file():
        files.append(package_dir / "README.md")
    for directory in sorted(INCLUDE_DIRS):
        root = package_dir / directory
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if not path.is_file() or EXCLUDE_PARTS.intersection(path.parts):
                continue
            if path.suffix.lower() not in INCLUDE_SUFFIXES:
                continue
            files.append(path)

    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(set(files)):
            archive.write(path, arcname=str(path.relative_to(package_dir)))

    sha256 = hashlib.sha256(dest.read_bytes()).hexdigest()
    manifest = {
        "package": name,
        "version": version,
        "zip": str(dest),
        "sha256": sha256,
        "files": len(set(files)),
        "validated": not report.errors,
        "warnings": report.warnings,
    }
    manifest_path = out_dir / f"{name}-{version}.manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return dest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path, help="skill package directory")
    parser.add_argument("out_dir", type=Path, help="output directory for the zip")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    build_zip(args.package, args.out_dir, force=args.force)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
