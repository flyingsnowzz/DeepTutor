import pytest

from deeptutor.services.jobs.artifacts import (
    ArtifactRejected,
    max_artifact_bytes,
    validate_artifact,
)


@pytest.mark.parametrize(
    "mime",
    [
        "text/plain",
        "text/vnd.mermaid",
        "image/png",
        "audio/mpeg",
        "video/mp4",
        "application/pdf",
        "application/zip",
    ],
)
def test_allowed_mime_types(mime):
    validate_artifact(mime_type=mime, size_bytes=10)


@pytest.mark.parametrize("mime", ["application/x-msdownload", "text/html", "image/svg+xml", ""])
def test_rejected_mime_types(mime):
    with pytest.raises(ArtifactRejected) as exc:
        validate_artifact(mime_type=mime, size_bytes=10)
    assert exc.value.code == "ARTIFACT_MIME_REJECTED"


def test_size_limit(monkeypatch):
    monkeypatch.setenv("MCP_ARTIFACT_MAX_BYTES", "100")
    assert max_artifact_bytes() == 100
    with pytest.raises(ArtifactRejected) as exc:
        validate_artifact(mime_type="text/plain", size_bytes=101)
    assert exc.value.code == "ARTIFACT_TOO_LARGE"
