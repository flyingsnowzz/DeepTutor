#!/usr/bin/env python3
"""Validate a WorkBuddy skill package for submission.

Checks:
  * required structure and SKILL.md frontmatter fields
  * no secrets/tokens/private keys/database URLs with credentials
  * no dangerous shell instructions or server paths
  * referenced MCP tool names match the server implementation
  * no forbidden score/official-grade promises in user-facing copy

Exits non-zero and prints a JSON report on failure.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
import json
from pathlib import Path
import re
import sys

REPO_ROOT = Path(__file__).resolve().parents[2]

REQUIRED_FILES = [
    "SKILL.md",
    "references/mcp-tools.md",
    "references/job-flow.md",
    "references/learning-workflows.md",
    "references/output-style.md",
    "references/safety-and-boundaries.md",
    "references/troubleshooting.md",
]
OPTIONAL_DIRS = ["templates", "examples", "listing"]
REQUIRED_FRONTMATTER = [
    "name",
    "display_name",
    "display_name_en",
    "description",
    "description_zh",
    "description_en",
    "version",
    "author",
]

# Patterns that must never appear in a submitted package.
SECRET_PATTERNS = [
    (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "private key block"),
    (r"(?<![A-Za-z0-9_])AKIA[0-9A-Z]{16}", "AWS access key id"),
    (r"postgres(?:ql)?://[^:\s\"']+:[^@\s\"']+@", "Postgres URL with password"),
    (r"mysql://[^:\s\"']+:[^@\s\"']+@", "MySQL URL with password"),
    (r"DEEPTUTOR_JWT_SECRET\s*=\s*[\"\'][^\"\']{8,}", "JWT secret assignment"),
    (
        r"(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[\"\'][^\"\']{8,}",
        "credential assignment",
    ),
    (r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}", "JWT-looking token"),
    (r"dt_refresh_[A-Za-z0-9_-]{20,}", "refresh token"),
]
DANGEROUS_PATTERNS = [
    (r"\brm\s+-rf?\b", "destructive shell command (rm -rf)"),
    (r"\bcurl\b[^\n|]*(http|https)://[^\n]*(--data|-d )", "data exfiltration via curl"),
    (r"\bwget\b[^\n]*\|\s*(sh|bash)", "pipe remote download to shell"),
    (
        r"(os\.system|subprocess\.(run|Popen|call)|child_process\.exec)",
        "arbitrary command execution API",
    ),
    (r"`exec` 工具|暴露\s*`?exec`?", "exposing exec to the host model"),
    (r"/(home|Users)/[A-Za-z0-9._-]+/", "absolute local user path"),
    (r"/var/(lib|www)/[A-Za-z0-9._/-]+", "server absolute path"),
]
FORBIDDEN_PROMISES = [
    r"保证提分",
    r"承诺提分",
    r"包过",
    r"官方(认证|认可)(成绩|分数)?",
    r"押中真题",
    r"guaranteed? (score|grade|exam) (improvement|pass)",
]
TEXT_SUFFIXES = {".md", ".txt", ".json", ".yaml", ".yml"}


@dataclass
class ValidationReport:
    package: str
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    files_checked: int = 0

    def fail(self, message: str) -> None:
        self.errors.append(message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)

    def as_dict(self) -> dict:
        return {
            "package": self.package,
            "ok": not self.errors,
            "errors": self.errors,
            "warnings": self.warnings,
            "files_checked": self.files_checked,
        }


def parse_frontmatter(text: str) -> dict:
    if not text.startswith("---\n"):
        raise ValueError("SKILL.md must start with a YAML frontmatter block (---)")
    parts = text.split("---", 2)
    if len(parts) < 3:
        raise ValueError("SKILL.md frontmatter is not closed (---)")
    try:
        import yaml
    except ImportError:  # pragma: no cover
        return _minimal_frontmatter(parts[1])
    data = yaml.safe_load(parts[1]) or {}
    if not isinstance(data, dict):
        raise ValueError("frontmatter must be a mapping")
    return data


def _minimal_frontmatter(block: str) -> dict:
    data: dict[str, str] = {}
    for line in block.splitlines():
        if ":" in line and not line.startswith((" ", "-", "#")):
            key, _, value = line.partition(":")
            data[key.strip()] = value.strip().strip("\"'")
    return data


def implemented_tool_names() -> set[str]:
    server = REPO_ROOT / "deeptutor" / "mcp_server" / "server.py"
    text = server.read_text(encoding="utf-8")
    return set(re.findall(r'@mcp\.tool\(name="([a-z0-9_]+)"\)', text))


def _scan_text(report: ValidationReport, path: Path, text: str, tool_names: set[str]) -> None:
    for pattern, label in SECRET_PATTERNS:
        if re.search(pattern, text, flags=re.IGNORECASE):
            report.fail(f"{path}: contains {label}")
    for pattern, label in DANGEROUS_PATTERNS:
        if re.search(pattern, text, flags=re.IGNORECASE):
            # The safety reference must be able to forbid exposing exec.
            if label.startswith("exposing exec") and path.name == "safety-and-boundaries.md":
                continue
            report.fail(f"{path}: {label}")
    if path.name == "SKILL.md":
        for pattern in FORBIDDEN_PROMISES:
            for match in re.finditer(pattern, text):
                prefix = text[max(0, match.start() - 4) : match.start()]
                if re.search(r"[不勿非]|禁止|不会|切勿|拒绝", prefix):
                    continue  # negated promise ("不承诺提分") is the required wording
                report.fail(f"{path}: forbidden promise matching /{pattern}/")
    # Tool names only need to be consistent inside reference docs / SKILL.md.
    if path.name == "mcp-tools.md" or path.name == "SKILL.md":
        backticked = set(re.findall(r"`([a-z][a-z0-9_]{3,})`", text))
        known_non_tools = {
            "ok",
            "data",
            "error",
            "code",
            "mode",
            "study",
            "summary",
            "quiz",
            "again",
            "hard",
            "good",
            "easy",
            "page",
            "section",
            "timestamp",
            "queued",
            "running",
            "succeeded",
            "failed",
            "canceled",
            "needs_input",
            "ready",
            "missing_dependency",
            "owner_user_id",
            "idempotency_key",
            "request_id",
            "entry_id",
            "job_id",
            "artifact_ref",
            "session_id",
            "material_id",
            "path_id",
            "review_task_id",
            "first_party",
            "mcp",
        }
        candidates = {t for t in backticked if "_" in t}
        unknown = sorted(candidates - tool_names - known_non_tools)
        # Heuristic: names ending with _get/_submit/_list/etc look like tools.
        suffixes = (
            "_get",
            "_submit",
            "_list",
            "_check",
            "_cancel",
            "_reply",
            "_start",
            "_bookmark",
            "_complete",
            "_register",
        )
        for name in unknown:
            if name.endswith(suffixes):
                report.fail(f"{path}: tool `{name}` is not implemented by the MCP server")


def validate(package_dir: Path) -> ValidationReport:
    report = ValidationReport(str(package_dir))
    if not package_dir.is_dir():
        report.fail(f"package directory not found: {package_dir}")
        return report

    for relative in REQUIRED_FILES:
        path = package_dir / relative
        if not path.is_file():
            report.fail(f"missing required file: {relative}")

    skill_file = package_dir / "SKILL.md"
    tool_names = implemented_tool_names()
    if not tool_names:
        report.fail("could not discover any @mcp.tool names from server.py")
    if skill_file.is_file():
        try:
            frontmatter = parse_frontmatter(skill_file.read_text(encoding="utf-8"))
        except ValueError as exc:
            report.fail(str(exc))
        else:
            for key in REQUIRED_FRONTMATTER:
                if not frontmatter.get(key):
                    report.fail(f"frontmatter field missing or empty: {key}")
            version = str(frontmatter.get("version", ""))
            if not re.fullmatch(r"(?:0|[1-9]\d*)\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", version):
                report.fail(f"version must be semver (MAJOR.MINOR.PATCH), got: {version!r}")
            if frontmatter.get("name") != package_dir.name:
                report.fail(
                    f"frontmatter name {frontmatter.get('name')!r} must equal directory "
                    f"name {package_dir.name!r}"
                )

    text_files = [
        p for p in package_dir.rglob("*") if p.is_file() and p.suffix.lower() in TEXT_SUFFIXES
    ]
    for path in text_files:
        rel = path.relative_to(package_dir)
        if rel.parts[0] == "listing":
            continue  # store materials describe the service, not agent instructions
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            report.fail(f"{rel}: not valid UTF-8 text")
            continue
        report.files_checked += 1
        _scan_text(report, rel, text, tool_names)

    if not (package_dir / "examples").exists():
        report.warn("examples/ directory is absent")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path, help="skill package directory")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON only")
    args = parser.parse_args()

    report = validate(args.package)
    print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2))
    if not args.json:
        print(
            f"{'PASS' if not report.errors else 'FAIL'}: {args.package} "
            f"({report.files_checked} text files, "
            f"{len(report.errors)} errors, {len(report.warnings)} warnings)",
            file=sys.stderr,
        )
    return 0 if not report.errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
