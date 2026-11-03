from __future__ import annotations

import pytest

from deeptutor_cli.mcp_runner import TurnCapabilityRunner


class FakeApp:
    def __init__(self, events_by_call):
        self.events_by_call = list(events_by_call)
        self.requests = []
        self.replies = []
        self.session = {"id": "session-test"}

    async def start_turn(self, request):
        self.requests.append(request)
        index = len(self.requests) - 1
        self.turn = {"id": f"turn-{index}"}
        return self.session, self.turn

    async def stream_turn(self, turn_id):
        index = int(turn_id.rsplit("-", 1)[1])
        for event in self.events_by_call[index]:
            yield event

    async def submit_user_reply(self, turn_id, text=None, **kwargs):
        self.replies.append((turn_id, text))
        return True


def result_event(metadata):
    return {"type": "result", "metadata": metadata}


def done_event():
    return {"type": "done", "metadata": {"status": "completed"}}


@pytest.mark.asyncio
async def test_problem_solve_maps_to_deep_solve(monkeypatch):
    app = FakeApp([[result_event({"response": "x=1 or x=3"}), done_event()]])
    monkeypatch.setattr("deeptutor.app.DeepTutorApp", lambda: app)

    outcome = await TurnCapabilityRunner().run(
        capability="problem_solve", payload={"prompt": "solve x²-4x+3=0"}
    )

    assert app.requests[0].capability == "deep_solve"
    assert outcome.result["response"] == "x=1 or x=3"


@pytest.mark.asyncio
async def test_research_auto_confirms_outline_and_runs_report(monkeypatch):
    app = FakeApp(
        [
            [
                result_event(
                    {
                        "response": "",
                        "outline_preview": True,
                        "topic": "cube volume",
                        "sub_topics": [{"title": "formula", "overview": "V=a³"}],
                    }
                ),
                done_event(),
            ],
            [result_event({"response": "full research report"}), done_event()],
        ]
    )
    monkeypatch.setattr("deeptutor.app.DeepTutorApp", lambda: app)

    outcome = await TurnCapabilityRunner().run(
        capability="deep_research",
        payload={
            "prompt": "research cube volume",
            "config": {"confirmed_outline": None},
        },
    )

    assert len(app.requests) == 2
    assert app.requests[1].content == "cube volume"
    assert app.requests[1].config["confirmed_outline"] == [
        {"title": "formula", "overview": "V=a³"}
    ]
    assert outcome.result["response"] == "full research report"


@pytest.mark.asyncio
async def test_headless_quick_research_starts_with_one_confirmed_topic(monkeypatch):
    app = FakeApp([[result_event({"response": "full research report"}), done_event()]])
    monkeypatch.setattr("deeptutor.app.DeepTutorApp", lambda: app)

    outcome = await TurnCapabilityRunner().run(
        capability="deep_research", payload={"prompt": "research cube volume"}
    )

    assert len(app.requests) == 1
    assert app.requests[0].config["depth"] == "quick"
    assert app.requests[0].config["confirmed_outline"] == [
        {"title": "research cube volume"}
    ]
    assert outcome.artifacts[0]["kind"] == "research_report"
    assert outcome.artifacts[0]["mime_type"] == "text/markdown"
    assert outcome.artifacts[0]["data"] == b"full research report"


@pytest.mark.asyncio
async def test_headless_turn_answers_ask_user(monkeypatch):
    app = FakeApp(
        [
            [
                {
                    "type": "tool_result",
                    "content": "[awaiting user reply to: level?]",
                    "metadata": {"call_id": "ask-1"},
                },
                result_event({"response": "path generated"}),
                done_event(),
            ]
        ]
    )
    monkeypatch.setattr("deeptutor.app.DeepTutorApp", lambda: app)

    outcome = await TurnCapabilityRunner().run(
        capability="deep_solve", payload={"prompt": "create a path"}
    )

    assert outcome.result["response"] == "path generated"
    assert app.replies and "默认假设" in app.replies[0][1]


@pytest.mark.asyncio
async def test_real_runner_rejects_placeholder(monkeypatch):
    app = FakeApp(
        [[result_event({"response": "Quiz generation executor placeholder."}), done_event()]]
    )
    monkeypatch.setattr("deeptutor.app.DeepTutorApp", lambda: app)

    with pytest.raises(RuntimeError, match="placeholder"):
        await TurnCapabilityRunner().run(
            capability="deep_question", payload={"prompt": "one question"}
        )


@pytest.mark.asyncio
async def test_audio_artifacts_are_collected_from_turn_workspace(monkeypatch, tmp_path):
    (tmp_path / "speech.mp3").write_bytes(b"real-mp3")
    (tmp_path / "speech.md").write_text("transcript", encoding="utf-8")
    app = FakeApp(
        [
            [
                result_event(
                    {
                        "response": "transcript",
                        "audio_path": "speech.mp3",
                        "transcript_path": "speech.md",
                    }
                ),
                done_event(),
            ]
        ]
    )
    monkeypatch.setattr("deeptutor.app.DeepTutorApp", lambda: app)
    monkeypatch.setattr(
        TurnCapabilityRunner,
        "_workspace_output_dir",
        lambda self, capability, session, turn: tmp_path,
    )

    outcome = await TurnCapabilityRunner().run(
        capability="audio_overview", payload={"prompt": "audio"}
    )

    assert [(a["filename"], a["data"]) for a in outcome.artifacts] == [
        ("speech.mp3", b"real-mp3"),
        ("speech.md", b"transcript"),
    ]


@pytest.mark.asyncio
async def test_math_artifacts_are_collected_from_turn_workspace(monkeypatch, tmp_path):
    (tmp_path / "artifacts").mkdir()
    (tmp_path / "artifacts" / "cube.mp4").write_bytes(b"real-video")
    app = FakeApp(
        [
            [
                result_event(
                    {
                        "response": "rendered",
                        "artifacts": [{"filename": "cube.mp4", "content_type": "video/mp4"}],
                    }
                ),
                done_event(),
            ]
        ]
    )
    monkeypatch.setattr("deeptutor.app.DeepTutorApp", lambda: app)
    monkeypatch.setattr(
        TurnCapabilityRunner,
        "_workspace_output_dir",
        lambda self, capability, session, turn: tmp_path,
    )

    outcome = await TurnCapabilityRunner().run(
        capability="math_animator", payload={"prompt": "animate"}
    )

    assert outcome.artifacts[0]["data"] == b"real-video"
    assert outcome.artifacts[0]["mime_type"] == "video/mp4"
    assert app.requests[0].config["generation_mode"] == "storyboard"


@pytest.mark.asyncio
async def test_workspace_item_uses_original_turn_workspace(monkeypatch, tmp_path):
    relative = "outputs/audio_overview/session/turn/speech.mp3"
    target = tmp_path / relative
    target.parent.mkdir(parents=True)
    target.write_bytes(b"real-audio")
    app = FakeApp(
        [
            [
                result_event(
                    {
                        "response": "transcript",
                        "workspace_items": [
                            {
                                "workspace_id": "ws-original",
                                "relative_path": relative,
                                "filename": "speech.mp3",
                                "mime_type": "audio/mpeg",
                            }
                        ],
                    }
                ),
                done_event(),
            ]
        ]
    )
    monkeypatch.setattr("deeptutor.app.DeepTutorApp", lambda: app)

    class Binding:
        root = tmp_path

    class Service:
        def binding_by_id(self, workspace_id):
            assert workspace_id == "ws-original"
            return Binding()

    monkeypatch.setattr(
        "deeptutor.services.workspace.get_content_workspace_service", lambda: Service()
    )

    outcome = await TurnCapabilityRunner().run(
        capability="audio_overview", payload={"prompt": "audio"}
    )

    assert outcome.artifacts[0]["data"] == b"real-audio"
    assert outcome.artifacts[0]["mime_type"] == "audio/mpeg"


@pytest.mark.asyncio
async def test_video_lesson_uses_storyboard_and_packages_html(monkeypatch, tmp_path):
    from io import BytesIO
    from zipfile import ZipFile

    artifact_dir = tmp_path / "turn-0" / "artifacts"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "lesson.html").write_text("<html>real lesson</html>", encoding="utf-8")
    app = FakeApp(
        [
            [
                result_event(
                    {
                        "response": "lesson ready",
                        "artifacts": [{"filename": "lesson.html", "content_type": "text/html"}],
                    }
                ),
                done_event(),
            ]
        ]
    )
    monkeypatch.setattr("deeptutor.app.DeepTutorApp", lambda: app)

    class Paths:
        def get_agent_dir(self, capability):
            assert capability == "video_lesson"
            return tmp_path

    monkeypatch.setattr("deeptutor.services.path_service.get_path_service", lambda: Paths())

    outcome = await TurnCapabilityRunner().run(
        capability="video_lesson", payload={"prompt": "teach cube volume"}
    )

    assert app.requests[0].config["generation_mode"] == "storyboard"
    artifact = outcome.artifacts[0]
    assert artifact["filename"] == "lesson.zip"
    assert artifact["mime_type"] == "application/zip"
    with ZipFile(BytesIO(artifact["data"])) as archive:
        assert archive.read("lesson.html") == b"<html>real lesson</html>"
