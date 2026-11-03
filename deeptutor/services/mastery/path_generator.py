"""One-shot mastery-path generation backed by the configured LLM and PostgreSQL."""

from __future__ import annotations

import json

from json_repair import repair_json
from sqlalchemy.ext.asyncio import AsyncEngine

from deeptutor.learning.storage_postgres import PostgresMasteryRepository
from deeptutor.services.llm import complete

_SYSTEM_PROMPT = """你是 DeepTutor 的掌握路径设计器。根据用户目标生成可执行的个性化学习路径。
只输出一个 JSON 对象，不要 Markdown。结构：
{
  "goal": "路径名称",
  "description": "路径说明",
  "objectives": [
    {"title": "阶段名称", "type": "CONCEPT|MEMORY|PROCEDURE|DESIGN",
     "description": "学什么以及如何判断掌握", "estimated_minutes": 15}
  ]
}
要求 2-6 个目标，按先备知识到应用排序；目标具体、可练习、可评价，不写空泛开场白。"""


class MasteryPathGenerator:
    def __init__(self, engine: AsyncEngine):
        self._repository = PostgresMasteryRepository(engine)

    async def generate(self, *, owner_user_id: str, prompt: str, language: str = "zh") -> dict:
        if not prompt.strip():
            raise ValueError("mastery_path requires a non-empty prompt")
        raw = await complete(prompt, system_prompt=_SYSTEM_PROMPT)
        data = json.loads(repair_json(raw))
        objectives = []
        for index, item in enumerate(list(data.get("objectives") or [])[:6], start=1):
            title = str(item.get("title") or "").strip()
            description = str(item.get("description") or "").strip()
            if not title or not description:
                continue
            objective_type = str(item.get("type") or "CONCEPT").upper()
            if objective_type not in {"CONCEPT", "MEMORY", "PROCEDURE", "DESIGN"}:
                objective_type = "CONCEPT"
            objectives.append(
                {
                    "id": f"obj-{index}",
                    "title": title,
                    "type": objective_type,
                    "description": description,
                    "estimated_minutes": max(1, min(int(item.get("estimated_minutes", 15) or 15), 240)),
                    "status": "pending",
                }
            )
        if not objectives:
            raise RuntimeError("Mastery path generation returned no usable objectives")
        goal = str(data.get("goal") or prompt[:120]).strip()
        state = {
            "goal": goal,
            "topic": goal,
            "description": str(data.get("description") or "").strip(),
            "emoji": "🎯",
            "status": "active",
            "language": language,
            "objectives": objectives,
            "source": "deeptutor_mcp_mastery_path_generate",
        }
        path_id = await self._repository.create_path(owner_user_id, state)
        state = {**state, "book_id": path_id, "path_id": path_id}
        return {
            "response": f"已生成掌握路径《{goal}》，包含 {len(objectives)} 个学习阶段。",
            "path_id": path_id,
            "path": state,
            "objectives": objectives,
            "generation_mode": "deeptutor_llm_postgres",
        }
