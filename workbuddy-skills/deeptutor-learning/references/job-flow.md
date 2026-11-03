# 长任务（Job）调用与轮询规则

研究、可视化、解题、出题、判分、音频、视频课、数学动画、掌握路径生成都是异步作业。
**绝不向用户假装已经完成**。

## 标准流程

```text
submit ──▶ queued/running ──轮询──▶ succeeded / failed / canceled / needs_input
```

1. 调用对应 `*_submit`（或通用 `capability_run_submit`），必带 `idempotency_key`。
2. 从返回取 `job_id`、`status`、`billing`；提交前若 `cost_hint.notice` 存在，先用一句话告知预计耗时与“成功后计费”（结构化视频课约 30 秒–数分钟、动画约 1–5 分钟、音频约 1–3 分钟）。
3. 用 `*_get` / `capability_job_get` 轮询：
   - 节奏：第 1 次 1–2 秒，之后指数退避到 5–10 秒；
   - 上限：连续等待约 10 分钟仍未结束，告知用户可稍后回来查询，并给出可继续的说法，不要无限轮询；
   - `poll_after_ms` 是服务端建议间隔。
4. `succeeded`：
   - 从 `artifacts[]` 取 `artifact_ref`，调 `artifact_get` 拿 900 秒短期 URL 再展示/播放；
   - 有 `result` 文本时按 output-style 组织讲解。
5. `failed`：用 `error.code/message` 转人话（见 troubleshooting），可建议修正参数后**用新的 idempotency_key** 重试；系统错误（retryable）可原样重试一次。
6. `canceled`：说明任务已取消；用户改主意时调 `capability_job_cancel`。
7. `needs_input`：用 `capability_job_reply` 补充信息后继续，**不要**重新 submit。

## 幂等规则

- 同一学习动作的网络重试/重复点击：复用同一个 `idempotency_key`，服务端返回同一个 job，不重复计费。
- 建议格式：`{scenario}:{topic-hash|job_topic}:{seq}`，≤128 字符。
- 真正的新尝试（换了题、换了参数）使用新 key。
- 练习判分/复习使用 `request_id` 而不是 job key；同一 request_id 重放返回首次结果（`replayed:true`）。

## 各作业典型耗时与产物

| 作业 | 预计耗时 | 成功产物 |
| --- | --- | --- |
| deep_research | 约 2–8 分钟 | 研究报告文本；附加知识库时包含引用 |
| visualize | 约 10–30 秒 | Mermaid/文本 artifact |
| deep_question | 约 20–40 秒 | 题目；生产环境会写入练习库 |
| problem_solve | 约 30–60 秒 | 分步解答+同类练习 |
| quiz_judge | 约 20–40 秒 | 形成性反馈（非官方分数） |
| audio_overview | 约 1–3 分钟 | 音频 + 逐字稿 |
| video_lesson | 约 30 秒–数分钟 | `application/zip`，解压后为可在浏览器播放的 `lesson.html` |
| math_animator | 约 1–5 分钟 | video/mp4（缺 Manim/LaTeX/ffmpeg 时 503） |

## 状态展示话术

- 排队/运行中：“已经开始生成，大约需要 X，你可以先做下一道题，完成后我会把链接发你。”
- 不要把 status 英文值直接抛给用户；进度信息用自然语言概括。
