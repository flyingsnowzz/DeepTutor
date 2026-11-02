from __future__ import annotations

import importlib.util

import pytest

from deeptutor.mcp_server.dependencies import media_dependencies


def test_dependency_report_shape():
    deps = media_dependencies()
    assert {"math_animator", "video_lesson", "immersive_reading", "audio_overview"} <= set(deps)
    for status in deps.values():
        assert isinstance(status.ready, bool)
        assert isinstance(status.missing, list)
        assert status.ready == (not status.missing)
        assert status.to_dict()["missing_dependencies"] == status.missing


def test_manim_dependency_reported_when_absent():
    if importlib.util.find_spec("manim"):
        pytest.skip("manim installed in this environment")
    report = media_dependencies()
    assert not report["math_animator"].ready
    assert any("manim" in m.lower() for m in report["math_animator"].missing)
