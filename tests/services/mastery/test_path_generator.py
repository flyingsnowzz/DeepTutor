from __future__ import annotations

import pytest

from deeptutor.services.mastery import path_generator


class FakeRepository:
    def __init__(self):
        self.state = None

    async def create_path(self, owner_user_id, state):
        self.state = state
        return "path-test"


@pytest.mark.asyncio
async def test_generates_and_persists_real_path(monkeypatch):
    repository = FakeRepository()
    monkeypatch.setattr(path_generator, "PostgresMasteryRepository", lambda engine: repository)

    async def fake_complete(prompt, system_prompt):
        return """{
          "goal": "立方体体积",
          "description": "从棱长到应用",
          "objectives": [
            {"title": "理解棱长", "type": "CONCEPT", "description": "辨认长宽高等量关系", "estimated_minutes": 10},
            {"title": "应用公式", "type": "PROCEDURE", "description": "用 V=a³ 计算并解释结果", "estimated_minutes": 20}
          ]
        }"""

    monkeypatch.setattr(path_generator, "complete", fake_complete)
    result = await path_generator.MasteryPathGenerator(object()).generate(
        owner_user_id="user-a", prompt="生成立方体体积掌握路径"
    )

    assert result["path_id"] == "path-test"
    assert len(result["objectives"]) == 2
    assert repository.state["goal"] == "立方体体积"
    assert result["generation_mode"] == "deeptutor_llm_postgres"
