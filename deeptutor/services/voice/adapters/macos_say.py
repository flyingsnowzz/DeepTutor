"""Offline speech synthesis through macOS ``say`` and ffmpeg."""

from __future__ import annotations

import asyncio
from pathlib import Path
import platform
import subprocess
import tempfile

from deeptutor.services.voice.base import BaseTTSAdapter, VoiceProviderError
from deeptutor.services.voice.config import TTSConfig


class MacOSSayTTSAdapter(BaseTTSAdapter):
    """Generate MP3 bytes without a network speech service."""

    async def synthesize(self, text: str, config: TTSConfig) -> tuple[bytes, str]:
        if platform.system() != "Darwin":
            raise VoiceProviderError("macOS say is only available on Darwin.")
        voice = config.voice or "Tingting"
        rate = max(80, min(round(180 * (config.speed or 1.0)), 400))
        with tempfile.TemporaryDirectory(prefix="deeptutor-say-") as directory:
            source = Path(directory) / "speech.aiff"
            target = Path(directory) / "speech.mp3"
            try:
                await asyncio.to_thread(
                    subprocess.run,
                    ["say", "-v", voice, "-r", str(rate), "-o", str(source), text],
                    check=True,
                    capture_output=True,
                )
                await asyncio.to_thread(
                    subprocess.run,
                    [
                        "ffmpeg",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-y",
                        "-i",
                        str(source),
                        "-codec:a",
                        "libmp3lame",
                        str(target),
                    ],
                    check=True,
                    capture_output=True,
                )
            except (OSError, subprocess.CalledProcessError) as exc:
                raise VoiceProviderError("macOS say speech synthesis failed.") from exc
            return target.read_bytes(), "audio/mpeg"
