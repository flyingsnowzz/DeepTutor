# MCP 工具契约（deeptutor-learning 0.1.0）

> 传输：stdio（本地）或 streamable HTTP（云端，`POST /mcp`，Bearer access token）。
> 统一返回：成功 `{ok:true,data:{...},error:null}`；失败 `{ok:false,data:null,error:{code,message,retryable,details}}`。
> 工具名与服务端实现一致（T4 冻结）。内部 ID（job/artifact/entry）只在工具间传递，不向用户展示。

## 0. 能力发现

### `capabilities_list`
- 入参：`include_dependencies?: boolean`，`locale?: "zh"|"en"`
- 返回：`capabilities[]`，每项含 `name / display_name / status(ready|missing_dependency) / supports_jobs / missing_dependencies[] / estimated_duration_sec / cost_hint`
- 规则：媒体类能力先看 status；`missing_dependency` 时不要提交，按清单告知用户缺什么。

## 1. 能力作业（异步 Job）

研究/可视化/解题/出题/判分/音频/视频/动画/掌握路径全部是作业，不是同步回答。

| 工具 | capability | 说明 |
| --- | --- | --- |
| `capability_run_submit` / `capability_job_get` / `capability_job_cancel` / `capability_job_reply` | 通用 | 入参 `capability / input / idempotency_key` |
| `quiz_generate_submit` / `quiz_generate_job_get` | deep_question | 出题练习 |
| `problem_solve_submit` / `problem_solve_get` | problem_solve | 分步解题+同类题 |
| `quiz_judge_submit` / `quiz_judge_get` | quiz_judge | 主观/图片题异步判分（形成性反馈） |
| `audio_overview_generate_submit/get` | audio_overview | 音频导学+逐字稿 |
| `lesson_video_generate_submit/get` | video_lesson | Remotion 视频课（约 2–8 分钟） |
| `math_animation_generate_submit/get` | math_animator | Manim 动画（约 1–5 分钟） |
| `mastery_path_generate_submit/get` | mastery_path | 掌握路径生成 |

- submit 返回：`job_id / session_id / status(queued|running) / poll_after_ms / billing{meter, charged_on:"job_succeeded"}`
- get 返回：`status / progress / result / artifacts[{artifact_ref,kind,mime_type,title}] / error / needs_input`
- 计费在作业**成功后**幂等发生；同一 `idempotency_key` 永远返回同一 job，不重复扣费。
- 错误：`CAPABILITY_UNAVAILABLE`(503 缺依赖)、`QUOTA_EXCEEDED`(429，details.upgrade_url)、`JOB_CONFLICT`、`NOT_FOUND`。
- needs_input 时用 `capability_job_reply` 补充，不要重新 submit。

### `artifact_get`
- 入参：`artifact_ref`、`disposition?: "url"`
- 返回：`url`（短期签名，`expires_in_sec=900`）、`mime_type`、`filename`
- 链接只能当次展示；过期重新获取。跨账户返回 `NOT_FOUND`。

## 2. 沉浸式精读（实时会话，非 Job）

| 工具 | 入参 | 返回要点 |
| --- | --- | --- |
| `reading_material_register` | `kind`(pdf/text/transcript/slides/url)、`title`、`content?`、`artifact_ref?` | `material_id / segment_count / locator_types` |
| `reading_session_start` | `material_id`、`mode?`(study/summary/quiz)、`title?` | `session_id / is_interactive:true / kind / segment_count` |
| `reading_session_reply` | `session_id`、`message`、`mode?` | `content / citations[{ordinal,locator_type,locator,snippet}] / followups[]` |
| `reading_sessions_list` | `limit?` | 历史会话 |

- PDF/课件：先经媒体作业或上传得到 `artifact_ref` 再注册；文本/字幕直接传 `content`。
- `locator_type`：`page`（PDF 页码）、`section`（章节）、`timestamp`（字幕 mm:ss）。
- 无匹配段落时 `citations=[]`；必须如实告知，不得编造引用。

## 3. 练习与错题

| 工具 | 入参 | 说明 |
| --- | --- | --- |
| `practice_entry_create` | `question / correct_answer / question_type? / options? / explanation? / knowledge_point_id? / mastery_path_id? / difficulty?` | 宿主自有题源或宿主模型生成题目入题库，返回 `entry_id`。优先用它承接 WorkBuddy 生成的内容，避免双端重复调模型 |
| `practice_question_get` | `entry_id` | 取题面（不含判分过程） |
| `practice_answer_check` | `entry_id / answer / request_id` | 确定性判分；答错自动建 SRS 错题行；挂掌握路径时写掌握证据事件 |
| `practice_review_submit` | `entry_id / rating(again|hard|good|easy) / request_id` | SM-2-lite 调度，返回下次 `due_at` |
| `practice_queue_list`（同 `review_tasks_list` 旧语义不同，见下注） | `limit?` | 到期错题（按 due_at） |
| `practice_entries_list` | `limit? / bookmarked? / resolved?` | 题目列表 |
| `practice_summary_get` | — | total/resolved/unresolved/bookmarked/mistakes/due + quota |
| `practice_entry_bookmark` | `entry_id / bookmarked` | 收藏 |

- `request_id`：每次**新的**答题/复习动作生成新值（UUID 即可）；网络重试同一动作必须复用原值 → 返回 `replayed:true`，绝不重复计分/扣额。
- 注意区分：`practice_queue_list` 是错题 SRS 队列；`review_tasks_list` 是“任务结束后生成的复习任务”（Hook/轮询）。

## 4. 掌握度

- `mastery_paths_list(limit?)`：路径列表（revision/state）。
- `mastery_map_get(path_id)`：聚合状态 + 交互/证据统计。
- `mastery_objective_get(path_id)`：目标与状态。
- 掌握路径生成是作业（见 §1）。所有写操作必须带证据与事件，重复提交不重复计分。

## 5. Hook 与复习任务

| 工具 | 入参 | 说明 |
| --- | --- | --- |
| `hook_event_submit` | `event_type`(job_completed/lesson_completed/material_finished)、`idempotency_key`、`source_ref?`、`channel?`、`payload?` | 幂等；复习类事件生成 1 个复习任务 |
| `review_tasks_list` | `limit?` | 到期复习任务（无宿主 Hook 时的轮询方案） |
| `review_task_complete` | `review_task_id / result?` | 完成复习任务 |
| `hook_deliveries_list` | `limit?` | 投递记录（调试） |

- 幂等键建议 `<channel>:<event>:<source_id>`；重复投递返回 `replayed:true` 与同一任务。
- 宿主不支持 Hook 时，技能改为定时引导学生调 `review_tasks_list`，**不要声称存在自动 Hook**。

## 6. 错误码对照

`UNAUTHENTICATED(401)` 引导登录；`NOT_FOUND(404)` 资源不存在或不属于本人（统一措辞）；
`INVALID_ARGUMENT(400)` 追问补参；`QUOTA_EXCEEDED(429)` 告知额度与升级；
`CAPABILITY_UNAVAILABLE(503)` 缺依赖；`RATE_LIMITED(429)` 稍后重试；
`JOB_CONFLICT(409)`/`IDEMPOTENCY_CONFLICT(409)`；`PAYLOAD_TOO_LARGE(413)`；
`INTERNAL_ERROR(500, retryable)` 安抚并建议稍后重试。完整表见服务端 `docs-for-dev/mcp/error-codes.md`。
