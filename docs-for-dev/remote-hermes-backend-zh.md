> **中文译本**：本文件由英文原文翻译；命令、路径、配置键、代码块和链接目标保持原样，如译文与实现存在歧义，以英文原文和当前代码为准。

# 远程 Hermes 智能体后端

[使用手册](README.md) · [相关指南](ARCHITECTURE.md)

DeepTutor Connected Agents 可以调用 Hermes Agent 网关，而无需在 DeepTutor 容器中安装 Hermes CLI。后端类型为`hermes_remote`，显示名称为**Hermes Agent（远程）**。

## 配置

每个后端设置位于正常 `subagent.json` 设置文档中的 `backends.hermes_remote` 下：

- `enabled`：聊天是否可以委托给该后端。
- `base_url`：网关根，例如 `http://hermes-uni:8642`。
- `api_key_env`：包含网关承载的环境变量名称。默认为 `DEEPTUTOR_HERMES_REMOTE_API_KEY`。
- `profile`：信息部署/配置文件标签；它不是凭证，也不用于构造 URL。
- `model`、 `effort`、 `system_prompt`、 `auto_approve`：与本地后端共享的运行控件。
- `idle_timeout_seconds`：SSE 帧之间的最大空闲间隔（默认 `600`）。来自网关的保持活动会重置此看门狗。

API 密钥仅适用于环境。它永远不会被接受为内联设置字段、持久化或由 `GET /api/subagents/settings` 返回。网关 URL 必须是不带凭据、查询文本或片段的 HTTP(S)。可选的 `/p/<profile>` 前缀支持 Hermes 多配置文件路由。重定向永远不会被遵循。

## HTTP合约

适配器使用经过身份验证的承载请求 (`Authorization: Bearer ...`) 和显式连接/读/写/池超时。端点和机器可读的功能契约记录在 [Hermes API 服务器指南](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/)中。

1. `GET /v1/capabilities` 检测可用性并验证配置的网关是否通告运行提交、事件流、停止、批准响应和会话资源。检测报告不同的 `not_configured`、 `key_missing`、 `unreachable`、 `unauthorized` 和 `incompatible` 详细信息。
2. `POST /v1/runs` 开始运行。该请求使用 `input` 作为用户提示，`instructions` 作为可选的第一会话系统指令，配置时使用 `model`，配置时使用 `model_options.reasoning_effort`，恢复时使用 `session_id`。服务器返回带有 `{ "run_id": "...", "status": "started" }` 的 HTTP 202。全新运行使用其运行 ID 作为会话 ID；恢复运行会保留提供的会话 ID。在恢复运行之前，适配器会获取 `GET /api/sessions/{session_id}/messages`。它仅保留非空用户/助理行，排除工具行，并最多将最后 40 行作为 `conversation_history` 发送。 404 意味着会话已消失：旧的会话 ID 和标头被删除，并且在再次应用 `system_prompt` 时重新开始运行，没有历史记录。
3. `GET /v1/runs/{run_id}/events` 是 SSE 流。帧在 `data:` 行中包含 JSON。适配器使用以下事件对象：`message.delta` ( `delta` )、`tool.started` ( `tool`、 `preview` )、`tool.completed` ( `tool`、 `error` )、`reasoning.available` ( `text` )）、`approval.request`、`run.completed`（`output`）、`run.failed`（`error`）和 `run.cancelled`。工具生命周期事件变成工具/工具结果行；答案增量成为合并 id `hermes_remote:final` 下的累积文本；其他生命周期事件成为日志/错误行。网关通过同一流发出工具/推理、文本/完成和批准事件。
4. `POST /v1/runs/{run_id}/approval` 解决了待批准的问题。自动批准时正文为 `{ "choice": "once" }`，`auto_approve` 为 false 时正文为 `{ "choice": "deny" }`。出现失败的批准响应，并且运行被停止而不是无限期地等待。
5. `POST /v1/runs/{run_id}/stop` 中断运行。取消通过屏蔽的、有界的清理窗口发布此请求，然后重新引发取消； SSE 空闲超时会发布该消息并返回错误。

会话连续性使用网关记录的 `X-Hermes-Session-Id` 标头和 `session_id` 请求字段。适配器还发送兼容性 `X-Hermes-Session` 标头。自定义 `system_prompt` 在新会话上或当历史记录查找报告会话已消失 (404) 时发送。每个请求都带有固定的 `CONSULT_ORIGIN_INSTRUCTION` 递归防护，用于识别 DeepTutor 连接的智能体，并告诉网关智能体直接应答，而不是委托回 DeepTutor。

`/v1/runs` API没有图片上传字段。因此，附件及其 DeepTutor 本地路径不会发送到远程网关。

## 隔离和安全

该后端将 Hermes 网关保持在 DeepTutor 进程/容器之外：工具在网关主机上运行，​​而不是在 DeepTutor 中运行。将每个 DeepTutor 聊天范围限定为其返回的会话 ID；不要在用户或聊天之间共享会话 ID。将 `API_SERVER_KEY`（网关的服务器端机密）和 `DEEPTUTOR_HERMES_REMOTE_API_KEY`（DeepTutor 端环境名称的值）排除在设置文件、日志、事件文本和前端有效负载之外。

除了适配器公开的结构化 SSE 生命周期之外，流式传输很安静。它不会轮询或重试 `POST /v1/runs`；调用者取消或空闲看门狗总是尝试有界停止。

## 实施与验证

- [deeptutor/services/subagent/hermes_remote.py](../deeptutor/services/subagent/hermes_remote.py)
- [deeptutor/services/subagent/hermes_remote_client.py](../deeptutor/services/subagent/hermes_remote_client.py)
- [deeptutor/services/subagent/hermes_remote_events.py](../deeptutor/services/subagent/hermes_remote_events.py)
- [测试/服务/test_hermes_remote_backend.py](../tests/services/test_hermes_remote_backend.py)