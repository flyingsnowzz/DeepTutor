# T0 CLI Spike 结果

> 日期：2026-11-01  
> 目的：在不实现 MCP Server 的前提下，验证现有 `deeptutor run --format json` 的 stdout/stderr 边界、失败模式、事件字段和后续 MCP 适配风险。

## 1. 环境

- 分支：`feat/workbuddy-mcp-goals`
- 运行方式：临时 `DEEPTUTOR_HOME=/tmp/deeptutor-t0-spike`，避免污染仓库数据。
- 模块状态：源码 checkout 中核心模块 installed/enabled；`renderer-manim` 非 ready；本次 CLI Spike 未依赖 Manim。
- 关键观察：临时 runtime home 没有激活 LLM profile，因此 `chat`、`visualize` 等需要 LLM 的 turn 以可复现的配置错误失败；这验证了错误事件形状。随后使用仓库已配置模型补跑成功路径，成功证据见第 3、8、9 节。

## 2. 命令与原始产物

| Capability | 命令 | stdout | stderr | 退出码 | 结果 |
| --- | --- | --- | --- | --- | --- |
| `chat`（失败配置） | `DEEPTUTOR_HOME=/tmp/deeptutor-t0-spike .venv/bin/python -m deeptutor_cli.main run chat '用一句话解释什么是二次函数。' --language zh --format json` | `/tmp/deeptutor-t0-spike/chat.stdout.json` | `/tmp/deeptutor-t0-spike/chat.stderr.log` | 0 | turn failed：未配置 active LLM |
| `visualize`（失败配置） | 同形态，消息为生成 Mermaid 图 | `/tmp/deeptutor-t0-spike/visualize.stdout.json` | `/tmp/deeptutor-t0-spike/visualize.stderr.log` | 0 | turn failed：未配置 active LLM |
| `deep_research`（缺 config） | 同形态，消息为间隔重复说明 | `/tmp/deeptutor-t0-spike/research.stdout.json` | `/tmp/deeptutor-t0-spike/research.stderr.log` | 1 | 请求准备阶段失败：缺显式 config |
| `chat`（成功） | `.venv/bin/python -m deeptutor_cli.main run chat '用一句中文解释什么是二次函数。' --language zh --format json` | `/tmp/deeptutor-t0-spike/chat-success.stdout.json` | `/tmp/deeptutor-t0-spike/chat-success.stderr.log` | 0 | 成功，13.22s，stderr 0B |
| `visualize`（成功） | `.venv/bin/python -m deeptutor_cli.main run visualize '用 Mermaid flowchart 画一个最简学习闭环：学习、练习、复习。' --language zh --format json` | `/tmp/deeptutor-t0-spike/visualize-success.stdout.jsonl` | `/tmp/deeptutor-t0-spike/visualize-success.stderr.log` | 0 | 成功，13.42s，Mermaid artifact/result |
| `deep_research`（成功，quick/notes） | `.venv/bin/python -m deeptutor_cli.main run deep_research '间隔重复为什么有助于记忆？给出简短学习建议。' --language zh --format json --config-json '{"mode":"notes","depth":"quick"}'` | `/tmp/deeptutor-t0-spike/research-success.stdout.jsonl` | `/tmp/deeptutor-t0-spike/research-success.stderr.log` | 0 | 成功，78.41s，输出 outline/sub_topics |

## 3. stdout 事件形状（chat / visualize）

失败时 stdout 仍是 JSON Lines，而不是进程级非零退出：

1. `session`：包含 `session_id`、`turn_id`、`seq=1`。
2. `error`：`content="No active LLM model is configured..."`，metadata 中：
   - `turn_terminal=true`
   - `status=failed`
   - `error_code=internal_error`
   - `retryable=true`
3. `done`：`metadata.status=failed`。

T1 MCP 适配不能只看进程退出码，必须读取最终 `done` / `error` 事件。

## 4. stderr 形状

stderr 输出 Loguru 错误和 Python traceback，例如：

- `ERROR deeptutor.services.session.turns.executor - Turn ... failed`
- `deeptutor.services.llm.exceptions.LLMConfigError`

T1 stdio MCP 必须保证：

- stdout 只输出 MCP 协议；
- traceback 写 stderr 或日志文件；
- MCP 错误响应不向外部宿主透出 traceback 或绝对路径。

## 5. deep_research 的前置配置

直接运行：

```bash
deeptutor run deep_research "..." --format json
```

在请求准备阶段失败，错误为：

```text
Invalid deep research config: mode: Field required; depth: Field required
```

T1 通用 job 工具不能只传自由 prompt；对 `deep_research` 必须构造白名单 config，例如：

```json
{
  "mode": "notes",
  "depth": "quick"
}
```

可选字段：`manual_subtopics`、`manual_max_iterations`、`confirmed_outline`。

## 6. 对 T1 的直接影响

1. `capability_run_submit` 必须按 capability 校验 config；不能把任意 dict 直接传给 runtime。
2. Job 终态以 turn 事件为准，不能以 CLI 退出码为准。
3. MCP stdio 必须严格隔离 stdout/stderr。
4. `capabilities_list` 应同时检查模块 enabled/ready 和 active model 配置；否则会提交注定失败的 job。
5. 未配置模型应映射为用户可理解的 `CAPABILITY_UNAVAILABLE` 或 `UPSTREAM_CONFIGURATION_MISSING`，不要原样返回 `internal_error`。
6. `deep_research` T1 最小 config 建议固定为 `mode=notes/report`、`depth=quick/standard`，不开放 manual 复杂参数。

## 7. 成功路径：chat

- 命令：`deeptutor run chat '用一句中文解释什么是二次函数。' --language zh --format json`
- 退出码：0
- 耗时：13.22s
- stdout：35,044B JSONL
- stderr：0B
- 事件：`session`、`stage_start`、`progress`、`thinking`、`content`、`result`、`done`、`session_meta`。
- 关键观察：成功路径存在大量逐 token `thinking/content` 事件。MCP Job 事件回放应做合并/裁剪，不能把每个 token 都作为工具结果返回。

## 8. 成功路径：visualize

- 命令：`deeptutor run visualize '用 Mermaid flowchart 画一个最简学习闭环：学习、练习、复习。' --language zh --format json`
- 退出码：0
- 耗时：13.42s
- stdout：19,590B JSONL
- stderr：0B
- `result.metadata` 关键字段：
  - `schema_version = deeptutor.visualization/v1`
  - `render_type = mermaid`
  - `payload.format = text/vnd.mermaid`
  - `payload.data` 为 Mermaid 代码
  - `fallback.renderer = svg`
  - `cost_summary.total_tokens = 6464`
  - `usage_summary.duration_seconds = 8.726`
- 结论：T1 的 `visualization_create_*` 可直接走通用 Job，最终从 result envelope 取 `payload.data` 或创建 artifact；MCP 返回应裁剪 token 流。

## 9. 成功路径：deep_research（quick/notes）

- 命令：

```bash
.venv/bin/python -m deeptutor_cli.main run deep_research   '间隔重复为什么有助于记忆？给出简短学习建议。'   --language zh --format json   --config-json '{"mode":"notes","depth":"quick"}'
```

- 退出码：0
- 耗时：78.41s
- stdout：420,590B JSONL
- stderr：0B
- 终态：`done.status=completed`
- `result.metadata` 关键字段：
  - `topic`
  - `sub_topics[]`
  - `research_config.mode=notes`
  - `research_config.depth=quick`
  - `usage_summary.total_calls=2`
  - `usage_summary.duration_seconds≈69.26`
- 注意：`notes/quick` 返回的是 outline preview/sub_topics，不等同完整 `report` 模式的长报告；T1 若开放研究工具，应在工具契约中区分 `notes` 与 `report`，并将 78 秒级任务强制 Job 化。

## 10. T1 前仍需补齐的 Spike

- `deep_question`：验证结构化题单、题型、数量、材料引用和失败重试。
- `mastery_path`：验证交互式 `needs_input/reply`、掌握度写入和复习任务。
- HTTP MCP：T3 前验证 streamable HTTP、401、取消和断线重连。
