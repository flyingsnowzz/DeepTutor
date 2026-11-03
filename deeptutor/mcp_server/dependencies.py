"""Readiness detection for media capabilities exposed over MCP."""

from __future__ import annotations

from dataclasses import dataclass, field
import importlib.util
import shutil


@dataclass(frozen=True)
class DependencyStatus:
    ready: bool
    missing: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"ready": self.ready, "missing_dependencies": self.missing}


def _has_module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def _has_binary(name: str) -> bool:
    return shutil.which(name) is not None


def media_dependencies() -> dict[str, DependencyStatus]:
    """Static, fast checks. Never imports heavy renderers."""
    manim = _has_module("manim")
    latex = _has_binary("latex") or _has_binary("xelatex")
    ffmpeg = _has_binary("ffmpeg")
    node = _has_binary("node") and _has_binary("npm")

    missing_manim = []
    if not manim:
        missing_manim.append("manim>=0.19.0 (python package)")
    if not latex:
        missing_manim.append("LaTeX (latex/xelatex)")
    if not ffmpeg:
        missing_manim.append("ffmpeg")

    missing_video = []
    if not node:
        missing_video.append("Node.js 22 + npm (Remotion render runtime)")
    if not ffmpeg:
        missing_video.append("ffmpeg")

    missing_audio = []
    try:
        from deeptutor.services.config.provider_runtime import resolve_tts_runtime_config

        resolve_tts_runtime_config()
    except Exception:  # noqa: BLE001 - readiness is a report, not an exception path
        missing_audio.append("active TTS model (speech synthesis)")

    # Reading needs PyMuPDF for PDF ingestion; text/transcript work without it.
    missing_reading = [] if _has_module("fitz") else ["PyMuPDF (PDF ingestion only)"]

    return {
        "math_animator": DependencyStatus(not missing_manim, missing_manim),
        "video_lesson": DependencyStatus(not missing_video, missing_video),
        "immersive_reading": DependencyStatus(True, missing_reading),
        "audio_overview": DependencyStatus(not missing_audio, missing_audio),
    }
