# 教学媒体工具契约（T4 交付给 T5 Skill 包）

> T4 只提供后端工具与媒体作业；Skill 的创建、frontmatter、本地调试、上架由 T5 负责。
> 所有工具走 T3 多账户 streamable HTTP（`POST /mcp`，Bearer access token），错误统一为
> `{ok:false,error:{code,...}}` 信封。长任务一律异步 Job，不阻塞 MCP 调用。

## 0. 能力与依赖

`capabilities_list` 返回每项能力的 `status`（`ready` / `missing_dependency`）与
`missing_dependencies`、`estimated_duration_sec`、`cost_hint`。

| 能力 | 依赖 | 缺失时行为 |
| --- | --- | --- |
| `video_lesson` | Node.js 22 + npm（Remotion）、ffmpeg、TTS | submit 返回 503 `CAPABILITY_UNAVAILABLE` |
| `math_animator` | manim>=0.19、LaTeX、ffmpeg | 同上（本机演示环境通常缺 manim） |
| `immersive_reading` | PyMuPDF（仅 PDF 摄入；文本/字幕不需要） | 文本/字幕仍 ready |
| `audio_overview` | 无重依赖 | — |

## 1. 沉浸式精读（实时会话，**不是 Job**）

精读是有状态的实时会话：先注册材料、再开会话，然后多轮 reply；每条 assistant 回复
都带页码/章节/时间戳引用。不要把它包装成轮询作业。

| 工具 | 入参 | 说明 |
| --- | --- | --- |
| `reading_material_register` | `kind`(pdf/text/transcript/slides/url)、`title`、`content?`、`artifact_ref?` | PDF/课件传作业产物 `artifact_ref`（从对象存储读取）；文本/字幕直接传 `content`。返回 `material_id`、`segment_count`、`locator_types` |
| `reading_session_start` | `material_id`、`mode?`(study/summary/quiz)、`title?` | 返回 `session_id`，`is_interactive:true` |
| `reading_session_reply` | `session_id`、`message`、`mode?` | 返回 `content` + `citations[]`（`ordinal/locator_type/locator/snippet`）+ `followups`；mode 自动识别“总结/出题” |
| `reading_sessions_list` | `limit?` | 会话列表 |

- locator：PDF→`page`（`第 N 页`），文本/课件→`section`（章节标题），视频字幕→`timestamp`（`mm:ss`）；
- 无匹配：`citations=[]` 并提示换说法/指定位置，不编造引用；
- 典型话术：逐段总结 → 针对段落提问 → `mode=quiz` 生成复习题（引用即出处）。

## 2. 视频课（异步 Job）

- `lesson_video_generate_submit`：`input.prompt`（主题/讲法）、`idempotency_key`；
  返回 `job_id`、`billing`（meter=media、成功后计费、notice 含“约 2–8 分钟、按 TTS/模型计费”）。
- `lesson_video_generate_get`：轮询；`succeeded` 后从 `artifacts[0]` 取 `artifact_ref`。
- `artifact_get`：900 秒短期授权 URL（video/mp4）；可 `capability_job_cancel` 取消渲染。

## 3. 数学动画（异步 Job + 依赖门）

- `math_animation_generate_submit/get` 同视频；依赖缺失时 submit 即返回
  `CAPABILITY_UNAVAILABLE`（503），`details.missing_dependencies` 列出 manim/LaTeX/ffmpeg；
- 代码生成、重试、Manim 渲染全部在服务端受控执行；不暴露 shell 与服务器路径；
- 产物为 video/mp4，同样走 `artifact_get` 短期 URL。

## 4. Hook 与复习触发

宿主在任务/课程结束后回调一次，DeepTutor 幂等地生成复习任务：

- `hook_event_submit`：`event_type`（`job_completed` / `lesson_completed` /
  `material_finished`）、`idempotency_key`（建议 `<channel>:<event>:<source_id>`）、
  `channel`、`source_ref`、`payload?`；返回 `delivery_id`、`replayed`、`review_tasks[]`。
- 规则：同 key 重复投递返回 `replayed:true` 与**同一**复习任务，绝不重复创建；
  复习类事件生成 `kind=quiz`，材料读完生成 `kind=summary`；失败投递进入
  `attempts/next_retry_at` 可重试。
- 宿主没有 Hook 能力时，用定时轮询（DeepTutor 侧方案，Skill 中不得伪造 Hook）：
  `review_tasks_list`（到期任务）→ 展示给学生 → 完成后 `review_task_complete`；
  另有错题复习队列 `practice_queue_list`（SM-2 调度）。
- `hook_deliveries_list` 用于调试/对账。

## 5. 渠道、成本与授权

- 作业 `input.source_channel` 标记来源（workbuddy/qianwen-office/doubao），进入运营统计；
- 媒体/研究/出题作业成功后按 meter 计量（见 T3 配额）；提交前展示 `cost_hint.notice`；
- 判分类结果仅为形成性反馈，**不得**宣传提分、官方成绩或认证；
- 所有产物按 owner 授权访问；跨账户读取返回 `NOT_FOUND`（不泄露资源是否存在）。

## 6. 演示证据

`scripts/mcp_t4_media_smoke.py`：三学段话术（K12/大学/研究生）精读引用、视频课
Job→artifact URL、Manim 依赖门、Hook 幂等复习任务，全流程 passed（2026-11-02）。
