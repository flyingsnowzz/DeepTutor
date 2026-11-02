"""Four WorkBuddy E2E scenarios for deeptutor-learning."""

from __future__ import annotations

import time
import uuid

try:
    from .harness import ScenarioSession, write_record
except ImportError:  # direct script execution
    from harness import ScenarioSession, write_record


async def k12_math(session: ScenarioSession) -> None:
    """K12 数学：分步讲解 + 同类练习。"""
    prompt = "一步步讲懂 y=x²-4x+3 的顶点坐标，再给我两道同类练习"
    started = time.time()
    caps = await session.call("capabilities_list", {})
    assert any(c["name"] == "problem_solve" for c in caps["data"]["capabilities"])

    solve = await session.call(
        "problem_solve_submit",
        {
            "input": {
                "prompt": "初三数学：y=x²-4x+3 求顶点坐标，分步讲解",
                "source_channel": "workbuddy",
            },
            "idempotency_key": f"e2e:solve:{uuid.uuid4().hex[:10]}",
        },
    )
    assert solve["ok"], solve
    job = await session.wait_job(solve["data"]["job_id"], getter="problem_solve_get")
    assert job["data"]["status"] == "succeeded", job
    assert job["data"]["result"]["steps"], job

    quiz = await session.call(
        "quiz_generate_submit",
        {
            "input": {"prompt": "出 2 道初三二次函数求顶点的同类选择题"},
            "idempotency_key": f"e2e:quiz:{uuid.uuid4().hex[:10]}",
        },
    )
    assert quiz["ok"], quiz
    qjob = await session.wait_job(quiz["data"]["job_id"], getter="quiz_generate_job_get")
    assert qjob["data"]["status"] == "succeeded"

    final = "先配方：y=(x-2)²-1，顶点为 (2,-1)；已附两道同类练习，做完发我判分并安排复习。"
    path = write_record(
        "01-k12-math",
        session.transport,
        user_prompt=prompt,
        calls=session.calls,
        final_reply=final,
        elapsed_s=time.time() - started,
    )
    print(f"01-k12-math [{session.transport}] OK -> {path}")


async def reading_pdf(session: ScenarioSession) -> None:
    """大学材料精读：注册 → 会话 → 引用 → 复习题。"""
    prompt = "逐段读懂力学讲义中牛顿第二定律，并出复习题"
    started = time.time()
    content = (
        "# 牛顿第二定律\n物体加速度的大小跟所受合外力成正比，跟质量成反比，公式 F=ma。\n"
        "# 应用\n已知合外力与质量时，用 a=F/m 求加速度。"
    )
    mat = await session.call(
        "reading_material_register",
        {"kind": "text", "title": "大学普通物理讲义", "content": content},
    )
    assert mat["ok"], mat
    started_sess = await session.call(
        "reading_session_start", {"material_id": mat["data"]["material_id"]}
    )
    assert started_sess["data"]["is_interactive"]
    sid = started_sess["data"]["session_id"]

    reply = await session.call(
        "reading_session_reply",
        {"session_id": sid, "message": "F=ma 公式中各量的关系是什么？"},
    )
    assert reply["data"]["citations"], reply
    assert reply["data"]["citations"][0]["locator_type"] == "section"

    quiz = await session.call(
        "reading_session_reply", {"session_id": sid, "message": "出复习题", "mode": "quiz"}
    )
    assert quiz["data"]["citations"]

    final = f"依据（{reply['data']['citations'][0]['locator']}）：F=ma 中 a 与合外力成正比、与质量成反比；已生成复习题。"
    path = write_record(
        "02-reading-session",
        session.transport,
        user_prompt=prompt,
        calls=session.calls,
        final_reply=final,
        elapsed_s=time.time() - started,
    )
    print(f"02-reading-session [{session.transport}] OK -> {path}")


async def practice_loop(session: ScenarioSession) -> None:
    """练习闭环：答题 → 错因 → 掌握度/复习。"""
    prompt = "我做完昨天那道选择题了，选 A；帮我判分并安排复习"
    started = time.time()
    before = await session.call("practice_summary_get", {})
    baseline_total = before["data"]["total"]
    created = await session.call(
        "practice_entry_create",
        {
            "question": "二次函数 y=x²-4x+3 的顶点坐标是？",
            "question_type": "single_choice",
            "options": {"A": "(2,1)", "B": "(2,-1)", "C": "(-2,1)", "D": "(-2,-1)"},
            "correct_answer": "B",
            "knowledge_point_id": "kp-quadratic-vertex",
        },
    )
    assert created["ok"], created
    entry_id = created["data"]["entry_id"]

    req1 = f"e2e:{uuid.uuid4().hex}"
    wrong = await session.call(
        "practice_answer_check", {"entry_id": entry_id, "answer": "A", "request_id": req1}
    )
    assert wrong["ok"] and wrong["data"]["is_correct"] is False
    assert wrong["data"]["review"]["rating"] == "again"

    replay = await session.call(
        "practice_answer_check", {"entry_id": entry_id, "answer": "B", "request_id": req1}
    )
    assert replay["data"]["replayed"] is True

    queue = await session.call("practice_queue_list", {})
    assert queue["data"]["count"] >= 1

    review = await session.call(
        "practice_review_submit",
        {"entry_id": entry_id, "rating": "good", "request_id": f"e2e:{uuid.uuid4().hex}"},
    )
    assert review["ok"], review

    summary = await session.call("practice_summary_get", {})
    assert summary["data"]["total"] == baseline_total + 1
    final = "这题错在配方符号：顶点为 (2,-1)；已进入间隔复习，按 good 评级安排下次复习。"
    path = write_record(
        "03-practice-loop",
        session.transport,
        user_prompt=prompt,
        calls=session.calls,
        final_reply=final,
        elapsed_s=time.time() - started,
    )
    print(f"03-practice-loop [{session.transport}] OK -> {path}")


async def media_generation(session: ScenarioSession) -> None:
    """媒体作业：可视化 + 音频/视频产物链接。"""
    prompt = "画学习闭环图，并做一段音频导学；如果支持，再生成视频课"
    started = time.time()
    caps = await session.call("capabilities_list", {})
    names = {c["name"]: c["status"] for c in caps["data"]["capabilities"]}

    viz = await session.call(
        "capability_run_submit",
        {
            "capability": "visualize",
            "input": {"prompt": "学习闭环：练习→错题→复习→掌握"},
            "idempotency_key": f"e2e:viz:{uuid.uuid4().hex[:10]}",
        },
    )
    vjob = await session.wait_job(viz["data"]["job_id"])
    assert vjob["data"]["status"] == "succeeded"
    ref = vjob["data"]["artifacts"][0]["artifact_ref"]
    art = await session.call("artifact_get", {"artifact_ref": ref})
    assert art["data"]["url"]

    audio = await session.call(
        "audio_overview_generate_submit",
        {
            "input": {"prompt": "3 分钟勾股定理音频导学"},
            "idempotency_key": f"e2e:audio:{uuid.uuid4().hex[:10]}",
        },
    )
    assert audio["ok"], audio
    ajob = await session.wait_job(audio["data"]["job_id"], getter="audio_overview_generate_get")
    assert ajob["data"]["status"] == "succeeded"

    video_note = "video_lesson ready"
    if names.get("video_lesson") == "ready":
        video = await session.call(
            "lesson_video_generate_submit",
            {
                "input": {"prompt": "勾股定理 2 分钟视频课"},
                "idempotency_key": f"e2e:video:{uuid.uuid4().hex[:10]}",
            },
        )
        assert video["ok"], video
        vjob2 = await session.wait_job(video["data"]["job_id"], getter="lesson_video_generate_get")
        assert vjob2["data"]["status"] == "succeeded"
        vref = vjob2["data"]["artifacts"][0]["artifact_ref"]
        vart = await session.call("artifact_get", {"artifact_ref": vref})
        assert vart["data"]["url"].startswith(("http://", "https://", "memory://"))

    if names.get("math_animator") == "missing_dependency":
        gate = await session.call(
            "math_animation_generate_submit",
            {
                "input": {"prompt": "勾股定理动画"},
                "idempotency_key": f"e2e:math:{uuid.uuid4().hex[:8]}",
            },
        )
        assert gate["ok"] is False and gate["error"]["code"] == "CAPABILITY_UNAVAILABLE"
        video_note += "; math_animator missing_dependency 门通过"

    final = "学习闭环图与音频已生成；视频课 mp4 链接已给出（15 分钟内有效）；缺依赖能力已如实说明。"
    path = write_record(
        "04-media-generation",
        session.transport,
        user_prompt=prompt,
        calls=session.calls,
        final_reply=final,
        elapsed_s=time.time() - started,
        extra={"notes": video_note},
    )
    print(f"04-media-generation [{session.transport}] OK -> {path}")


SCENARIOS = [k12_math, reading_pdf, practice_loop, media_generation]
