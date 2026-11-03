from __future__ import annotations

from types import SimpleNamespace

import pytest

from deeptutor.agents.research.pipeline import ResearchPipeline


@pytest.mark.asyncio
async def test_quick_report_step_has_bounded_wait():
    pipeline = object.__new__(ResearchPipeline)
    pipeline.research_depth = "quick"

    async def step():
        return "ok"

    assert await pipeline._report_step_with_budget(step) == "ok"


def test_fallback_section_uses_actual_research_evidence():
    section = SimpleNamespace(id="R1", title="公式含义", intent="解释 V=a³", block_ids=("b1",))
    block = SimpleNamespace(
        block=SimpleNamespace(block_id="b1", tool_traces=[]),
        knowledge="立方体体积等于长乘宽乘高，因此 V=a³。",
    )

    body = ResearchPipeline._fallback_report_section(
        section=section, section_number=2, blocks=[block]
    )

    assert body.startswith("## 2. 公式含义")
    assert "V=a³" in body


@pytest.mark.asyncio
async def test_quick_kb_prefetch_forces_rag_and_registers_evidence():
    import json

    from deeptutor.agents.research.data_structures import TopicBlock
    from deeptutor.runtime.agentic.tool_dispatch import DispatchOutcome

    pipeline = object.__new__(ResearchPipeline)
    pipeline.research_depth = "quick"
    pipeline.kb_name = "cube-kb"
    pipeline._is_obsidian_kb = False
    pipeline._pageindex_tool_context = None
    pipeline._block_tool_names = lambda: ["rag"]
    pipeline._use_native_block_tools = lambda names: names == ["rag"]

    class Host:
        def __init__(self):
            self.calls = None

        async def dispatch_tools(self, *, iteration, tool_calls):
            self.calls = (iteration, tool_calls)
            return DispatchOutcome(
                tool_messages=[{"role": "tool", "content": "[CIT-1-01] cube evidence"}]
            )

    host = Host()
    block = TopicBlock(block_id="block_1", sub_topic="立方体体积", overview="V=a³")
    evidence = await pipeline._prefetch_quick_kb_evidence(block=block, host=host)

    iteration, tool_calls = host.calls
    assert iteration == 0
    assert tool_calls[0]["name"] == "rag"
    assert json.loads(tool_calls[0]["arguments"]) == {
        "query": "立方体体积\nV=a³",
        "kb_name": "cube-kb",
    }
    assert evidence == "[CIT-1-01] cube evidence"


@pytest.mark.asyncio
async def test_quick_kb_prefetch_without_evidence_fails_closed():
    from deeptutor.agents.research.data_structures import TopicBlock
    from deeptutor.runtime.agentic.tool_dispatch import DispatchOutcome

    pipeline = object.__new__(ResearchPipeline)
    pipeline.research_depth = "quick"
    pipeline.kb_name = "cube-kb"
    pipeline._is_obsidian_kb = False
    pipeline._pageindex_tool_context = None
    pipeline._block_tool_names = lambda: ["rag"]
    pipeline._use_native_block_tools = lambda names: True

    class Host:
        async def dispatch_tools(self, *, iteration, tool_calls):
            return DispatchOutcome()

    block = TopicBlock(block_id="block_1", sub_topic="立方体体积", overview="")
    with pytest.raises(RuntimeError, match="RAG returned no evidence"):
        await pipeline._prefetch_quick_kb_evidence(block=block, host=Host())
