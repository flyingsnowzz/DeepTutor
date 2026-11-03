from __future__ import annotations

from pathlib import Path
import subprocess

import pytest

from deeptutor.services.config.provider_runtime import TTS_PROVIDERS, resolve_tts_runtime_config
from deeptutor.services.voice.adapters.macos_say import MacOSSayTTSAdapter
from deeptutor.services.voice.config import TTSConfig


def catalog():
    return {
        "version": 1,
        "connections": [{"id": "speech", "provider": "macos_say"}],
        "services": {
            "tts": {
                "active_profile_id": "p",
                "active_model_id": "m",
                "profiles": [
                    {
                        "id": "p",
                        "provider_ref": {"connection_id": "speech", "binding": "macos_say"},
                        "models": [{"id": "m", "model": "macos-say", "voice": "Tingting"}],
                    }
                ],
            }
        },
    }


def test_macos_say_resolves_as_local_provider():
    resolved = resolve_tts_runtime_config(catalog())
    assert resolved.provider_name == "macos_say"
    assert resolved.adapter == TTS_PROVIDERS["macos_say"].adapter == "macos_say"
    assert resolved.voice == "Tingting"


@pytest.mark.asyncio
async def test_macos_say_returns_mp3(monkeypatch, tmp_path):
    commands = []

    def fake_run(command, check, capture_output):
        commands.append(command)
        output = Path(command[-1])
        output.write_bytes(b"aiff" if command[0] == "say" else b"mp3")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(subprocess, "run", fake_run)
    class TempDir:
        def __enter__(self):
            return str(tmp_path)

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(
        "deeptutor.services.voice.adapters.macos_say.tempfile.TemporaryDirectory",
        lambda **kwargs: TempDir(),
    )
    audio, content_type = await MacOSSayTTSAdapter().synthesize(
        "立方体体积", TTSConfig(model="macos-say", voice="Tingting")
    )

    assert audio == b"mp3"
    assert content_type == "audio/mpeg"
    assert commands[0][0] == "say"
    assert commands[1][0] == "ffmpeg"
