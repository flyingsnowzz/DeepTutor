import asyncio
import json

import pytest

from deeptutor.mcp_server.server import _truncate, create_mcp_server
from deeptutor.services.jobs.service import InMemoryJobService
from deeptutor.services.storage.object_store import InMemoryObjectStore


def _content(result):
    if isinstance(result, dict):
        return result
    if isinstance(result, (list, tuple)):
        first = result[0]
        return getattr(first, "text", str(first))
    return getattr(result, "text", str(result))


async def _call(server, name, arguments):
    raw = await server.call_tool(name, arguments)
    text = _content(raw)
    return json.loads(text) if isinstance(text, str) else text


async def wait_job_payload(server, job_id):
    for _ in range(50):
        fetched = await _call(server, "capability_job_get", {"job_id": job_id})
        if fetched["data"]["status"] in {"succeeded", "failed", "canceled"}:
            return fetched
        await asyncio.sleep(0.01)
    raise AssertionError("job did not reach terminal state")


@pytest.mark.asyncio
async def test_lists_capabilities():
    server = create_mcp_server(owner_user_id="user-a")
    payload = await _call(server, "capabilities_list", {})
    assert payload["data"]["execution_mode"] == "deterministic"
    names = {item["name"] for item in payload["data"]["capabilities"]}
    assert {"deep_research", "visualize", "deep_question"} <= names


@pytest.mark.asyncio
async def test_visualize_submit_get_artifact_flow():
    store = InMemoryObjectStore()
    jobs = InMemoryJobService(store)
    server = create_mcp_server(owner_user_id="user-a", job_service=jobs, object_store=store)
    submitted = await _call(
        server,
        "capability_run_submit",
        {
            "capability": "visualize",
            "input": {"prompt": "画学习闭环"},
            "idempotency_key": "visualize-1",
        },
    )
    job_id = submitted["data"]["job_id"]
    fetched = await wait_job_payload(server, job_id)
    assert fetched["data"]["status"] == "succeeded"
    artifact_ref = fetched["data"]["artifacts"][0]["artifact_ref"]
    artifact = await _call(server, "artifact_get", {"artifact_ref": artifact_ref})
    assert artifact["data"]["url"].startswith("memory://")


@pytest.mark.asyncio
async def test_unsupported_capability_rejected():
    server = create_mcp_server(owner_user_id="user-a")
    result = await _call(
        server,
        "capability_run_submit",
        {
            "capability": "chat",
            "input": {"prompt": "hello"},
        },
    )
    # T0 error contract: stable JSON envelope instead of a thrown exception.
    assert result["ok"] is False
    assert result["error"]["code"] == "UNSUPPORTED_CAPABILITY"


@pytest.mark.asyncio
async def test_quiz_generate_alias_accepted():
    server = create_mcp_server(owner_user_id="user-a")
    submitted = await _call(
        server,
        "quiz_generate_submit",
        {
            "input": {"prompt": "出 3 道二次函数选择题"},
            "idempotency_key": "quiz-1",
        },
    )
    assert submitted["data"]["status"] in {"queued", "running"}
    fetched = await wait_job_payload(server, submitted["data"]["job_id"])
    assert fetched["data"]["status"] == "succeeded"


@pytest.mark.asyncio
async def test_research_job_succeeds_with_deterministic_runner():
    server = create_mcp_server(owner_user_id="user-a")
    submitted = await _call(
        server,
        "capability_run_submit",
        {
            "capability": "deep_research",
            "input": {"prompt": "间隔重复", "config": {"mode": "notes", "depth": "quick"}},
            "idempotency_key": "research-1",
        },
    )
    fetched = await wait_job_payload(server, submitted["data"]["job_id"])
    assert fetched["data"]["status"] == "succeeded"


def test_truncating_large_job_result_preserves_job_envelope():
    payload = {
        "job_id": "job-large",
        "status": "succeeded",
        "result": {"response": "研究报告" * 4000},
        "artifacts": [{"artifact_ref": "artifact-1", "kind": "report"}],
        "error": None,
    }

    truncated = _truncate(payload)

    assert isinstance(truncated, dict)
    assert truncated["status"] == "succeeded"
    assert truncated["artifacts"] == payload["artifacts"]
    assert truncated["result"]["response"].endswith("…[truncated]")
    assert len(json.dumps(truncated, ensure_ascii=False)) <= 8000


def test_truncation_drops_verbose_usage_before_research_report():
    report = "完整研究结论。" * 500
    payload = {
        "job_id": "job-research",
        "status": "succeeded",
        "result": {
            "response": report,
            "metadata": {
                "citation_count": 2,
                "usage_summary": {
                    "call_details": [
                        {"call_id": f"call-{index}", "diagnostic": "x" * 500}
                        for index in range(20)
                    ]
                },
            },
        },
        "artifacts": [],
        "error": None,
    }

    truncated = _truncate(payload)

    assert truncated["result"]["response"] == report
    assert "call_details" not in truncated["result"]["metadata"]["usage_summary"]
    assert truncated["result"]["metadata"]["citation_count"] == 2
    assert len(json.dumps(truncated, ensure_ascii=False)) <= 8000
