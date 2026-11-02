from __future__ import annotations

import json
from pathlib import Path
import zipfile

import pytest

from scripts.release.validate_workbuddy_skill import (
    REQUIRED_FILES,
    REQUIRED_FRONTMATTER,
    parse_frontmatter,
    validate,
)


def test_package_validates(package_dir: Path):
    report = validate(package_dir)
    assert report.errors == [], report.errors
    assert report.files_checked >= 14


def test_required_structure_and_frontmatter(package_dir: Path):
    for relative in REQUIRED_FILES:
        assert (package_dir / relative).is_file(), relative

    frontmatter = parse_frontmatter((package_dir / "SKILL.md").read_text(encoding="utf-8"))
    for key in REQUIRED_FRONTMATTER:
        assert frontmatter.get(key), key
    assert frontmatter["name"] == "deeptutor-learning"
    assert frontmatter["version"] == "0.1.0"
    assert frontmatter["display_name_en"]
    assert frontmatter["examples_zh"]
    assert len(frontmatter["examples_zh"]) >= 3


def test_no_executable_scripts_in_package(package_dir: Path):
    forbidden = {".py", ".sh", ".js", ".ts", ".ps1", ".bat", ".exe"}
    offenders = [
        str(p.relative_to(package_dir))
        for p in package_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in forbidden
    ]
    assert offenders == [], offenders


def test_references_match_server_tool_names(package_dir: Path):
    report = validate(package_dir)
    # mcp-tools.md and SKILL.md are checked against @mcp.tool registrations.
    assert not [e for e in report.errors if "not implemented by the MCP server" in e]


def test_listing_materials_present(package_dir: Path):
    listing = package_dir / "listing"
    for name in (
        "icon.png",
        "showcase.png",
        "short-description.md",
        "privacy-policy.md",
        "terms-of-service.md",
        "minors-protection.md",
        "service-dependency.md",
        "auth-and-unlink.md",
        "support-contact.md",
    ):
        assert (listing / name).is_file(), name
    assert (listing / "icon.png").stat().st_size > 1000


def test_zip_build(package_dir: Path, tmp_path: Path):
    from scripts.release.build_workbuddy_skill_zip import build_zip

    dest = build_zip(package_dir, tmp_path)
    assert dest.is_file() and dest.stat().st_size > 1000
    manifest = json.loads((tmp_path / f"{dest.stem}.manifest.json").read_text())
    assert manifest["validated"] is True
    assert manifest["version"] == "0.1.0"
    with zipfile.ZipFile(dest) as archive:
        names = set(archive.namelist())
        assert "SKILL.md" in names
        assert any(n.startswith("references/") for n in names)
        assert any(n.startswith("listing/") for n in names)
        assert not any(n.endswith(".py") for n in names)


def test_validator_rejects_secret_and_bad_semver(tmp_path: Path):
    pkg = tmp_path / "bad-skill"
    (pkg / "references").mkdir(parents=True)
    (pkg / "SKILL.md").write_text(
        "---\n"
        "name: bad-skill\n"
        "display_name: Bad\n"
        "display_name_en: Bad\n"
        "description: x\n"
        "description_zh: x\n"
        "description_en: x\n"
        "version: not-semver\n"
        "author: x\n"
        "---\n"
        "password: 'super-secret-123'\n",
        encoding="utf-8",
    )
    for name in REQUIRED_FILES[1:]:
        (pkg / name).write_text("# placeholder\n", encoding="utf-8")
    report = validate(pkg)
    assert any("version" in e for e in report.errors)
    assert any("credential assignment" in e for e in report.errors)


def test_validator_detects_unknown_tool(tmp_path: Path, package_dir: Path):
    import shutil

    pkg = tmp_path / "deeptutor-learning"
    shutil.copytree(package_dir, pkg)
    (pkg / "references" / "mcp-tools.md").write_text(
        "`totally_unknown_tool_get` should be rejected\n", encoding="utf-8"
    )
    report = validate(pkg)
    assert any("totally_unknown_tool_get" in e for e in report.errors)
