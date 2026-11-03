from pathlib import Path


def test_mcp_requirements_install_sqlalchemy_asyncio_extra() -> None:
    requirements = Path("requirements/mcp.txt").read_text(encoding="utf-8")

    assert "SQLAlchemy[asyncio]>=2.0.0" in requirements.splitlines()
