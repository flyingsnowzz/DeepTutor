# T0 — 契约冻结与本地 Spike

## 目标

在编写生产 MCP Server 前，确认外部宿主集成边界、工具契约、作业状态机、数据模型和现有 CLI 能力，避免后续把 DeepTutor 内部实现直接暴露给 WorkBuddy。

## 输入

- [`../docs-for-dev/WorkBuddy集成方案.md`](../docs-for-dev/WorkBuddy集成方案.md)
- 现有 CLI：`deeptutor run --format json`
- 现有运行时：`TurnApplicationService`、`TurnEngine`、`ChatOrchestrator`
- 现有模块 manifest：`deeptutor/modules/manifests/*.json`

## 范围

### 1. CLI Spike

用现有 CLI 分别验证：

- `deep_research`
- `visualize`
- `deep_question`
- `chat`
- `mastery_path`（如本地依赖满足）

记录每种能力的：

- 启动命令；
- 必需配置；
- 成功输出；
- stdout/stderr 边界；
- 耗时；
- 失败模式；
- 最终结果字段；
- usage/cost 字段；
- 是否会请求用户补充输入；
- 是否产生文件 artifact。

### 2. 冻结 MCP 工具契约

至少冻结以下工具的 JSON Schema、错误码和字段长度：

- `capabilities_list`
- `capability_run_submit`
- `capability_job_get`
- `capability_job_cancel`
- `capability_job_reply`
- `artifact_get`
- `practice_summary_get`
- `practice_queue_list`
- `practice_question_get`
- `practice_answer_check`
- `practice_review_submit`
- `practice_entries_list`
- `practice_entry_bookmark`
- `mastery_paths_list`
- `mastery_map_get`
- `mastery_objective_get`
- `review_tasks_list`

### 3. 冻结作业状态机

定义并评审：

```text
queued → running → succeeded
                  ├→ failed
                  ├→ canceled
                  └→ needs_input → running → succeeded/failed/canceled
```

明确：

- 幂等键范围：`(owner_user_id, idempotency_key)` 唯一；
- 重复提交返回同一 job；
- cancel 的语义和可取消阶段；
- needs_input 的超时策略；
- failed 是否可重试；
- job 与 artifact 的关系。

### 4. 数据与环境变量契约

确认 T1 起使用：

- `DATABASE_URL=postgresql+asyncpg://...`
- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `DEEPTUTOR_TOKEN`
- 可选：`REDIS_URL`

确认密钥不进入：

- Skill 文档；
- mcp.json；
- 日志；
- Git；
- 前端代码。

### 5. WorkBuddy Skill 草稿

起草但不上架：

- Skill 名称；
- 触发词；
- frontmatter 必填字段；
- 学习场景；
- 调用 MCP 工具的业务流程；
- 不支持事项；
- 错误提示文案。

## 产出物

- `docs-for-dev/mcp/tool-contracts.md`（如无目录则创建）
- `docs-for-dev/mcp/job-state-machine.md`
- `docs-for-dev/mcp/error-codes.md`
- `docs-for-dev/workbuddy-skill-draft.md`
- Spike 记录：成功/失败样例和耗时
- T1 开发任务拆解

## 完成标准

- [ ] 所有候选工具都有输入/输出 JSON Schema。
- [ ] 工具名称、字段和错误码经评审冻结。
- [ ] job 状态机、幂等和取消语义明确。
- [ ] 至少 2 个 Capability 的 CLI Spike 可稳定复现。
- [ ] 明确哪些能力 T1 开放、哪些延期。
- [ ] 文档说明自有 App/Web/SDK 不走 MCP。
- [ ] 文档说明新 SaaS/MCP 路径不使用 SQLite。
- [ ] Skill 草稿通过 frontmatter 静态检查。

## 非目标

- 不实现生产 MCP Server。
- 不发布 Skill。
- 不接入真实 WorkBuddy 市场。
- 不实现订阅支付。
- 不做视频/Manim 重能力。

