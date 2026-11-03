import pytest

from deeptutor.runtime.request_contracts import validate_capability_config


def test_video_lesson_defaults_to_first_party_freeform():
    config = validate_capability_config("video_lesson", {})
    assert config == {"generation_mode": "freeform"}


def test_video_lesson_allows_mcp_storyboard_mode():
    config = validate_capability_config(
        "video_lesson", {"generation_mode": "storyboard"}
    )
    assert config == {"generation_mode": "storyboard"}


def test_video_lesson_rejects_unknown_config():
    with pytest.raises(ValueError, match="generation_mode"):
        validate_capability_config("video_lesson", {"generation_mode": "untrusted"})
