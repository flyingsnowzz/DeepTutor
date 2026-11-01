# T0 — 契约冻结与本地 Spike

> Codex goal-mode target：完成本目标时，必须交付“产出物”中的文件/代码，并按“验收命令”运行测试，留下可审查证据。


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

- [x] 所有候选工具都有输入/输出 JSON Schema。
- [x] 工具名称、字段和错误码经评审冻结。
- [x] job 状态机、幂等和取消语义明确。
- [x] 至少 2 个 Capability 的 CLI Spike 可稳定复现。
- [x] 明确哪些能力 T1 开放、哪些延期。
- [x] 文档说明自有 App/Web/SDK 不走 MCP。
- [x] 文档说明新 SaaS/MCP 路径不使用 SQLite。
- [x] Skill 草稿通过 frontmatter 静态检查。

## Codex 实施任务

1. 创建 `docs-for-dev/mcp/` 目录和三份契约文档：`tool-contracts.md`、`job-state-machine.md`、`error-codes.md`。
2. 为每个 T1/T2 首批工具补齐 JSON Schema、错误码、示例和结果裁剪规则。
3. 用现有 CLI 跑至少两个 Capability Spike，记录原始命令、结果字段、耗时和失败样例。
4. 起草 `docs-for-dev/workbuddy-skill-draft.md`，但不创建正式 Skill 包。
5. 补充 `deploy/env/mcp.example.env` 的变量契约草案。

## 验收命令/证据

```bash
# 1. 契约文件存在且包含首批工具
grep -R "capability_run_submit" docs-for-dev/mcp/tool-contracts.md
grep -R "needs_input" docs-for-dev/mcp/job-state-machine.md
grep -R "UNAUTHORIZED\|QUOTA_EXCEEDED\|JOB_FAILED" docs-for-dev/mcp/error-codes.md

# 2. Spike 记录可复现
python -m deeptutor_cli.main run visualize "..." --format json
python -m deeptutor_cli.main run deep_research "..." --format json

# 3. Markdown 围栏成对
python - <<'PYCHECK'
from pathlib import Path
for p in Path('docs-for-dev/mcp').glob('*.md'):
    s=p.read_text()
    assert sum(x.lstrip().startswith('```') for x in s.splitlines()) % 2 == 0, p
print('mcp docs ok')
PYCHECK
```

## 非目标

- 不实现生产 MCP Server。
- 不发布 Skill。
- 不接入真实 WorkBuddy 市场。
- 不实现订阅支付。
- 不做视频/Manim 重能力。

