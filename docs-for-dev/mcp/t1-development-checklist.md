# T1 开发任务拆解

> 来源：T0 契约。目标是让 Codex 可以按任务实现 [`../../goals/T1-本地MCP最小闭环.md`](../../goals/T1-本地MCP最小闭环.md)。

## 1. 基础设施

- [ ] 新增 `deploy/docker-compose.postgres-minio.yml`。
- [ ] 新增 Postgres/MinIO/Redis 本地环境变量样例。
- [ ] 增加 SQLAlchemy 2.x、asyncpg、Alembic、S3 client 依赖声明。
- [ ] CI 可启动真实 Postgres/MinIO。

## 2. MCP 入口

- [ ] 新增 `deeptutor/mcp_server/`。
- [ ] 新增 `deeptutor_cli/mcp.py` 和 `deeptutor mcp serve --transport stdio`。
- [ ] stdout 只输出 MCP 协议，日志写 stderr。
- [ ] 生命周期与现有 ApplicationContainer 对齐。

## 3. Job/Artifact

- [ ] 实现 `jobs`、`artifacts`、`usage_events` 初始迁移。
- [ ] 实现 `(owner_user_id,idempotency_key)` 唯一约束。
- [ ] 实现 Job 状态机：queued/running/needs_input/succeeded/failed/canceled。
- [ ] Artifact 元数据入库，二进制写 MinIO/S3。
- [ ] `artifact_get` 返回短期 URL，不返回本地路径。

## 4. MCP 工具（T1）

- [ ] `capabilities_list`
- [ ] `capability_run_submit`
- [ ] `capability_job_get`
- [ ] `capability_job_cancel`
- [ ] `capability_job_reply`
- [ ] `artifact_get`
- [ ] P1 末：`quiz_generate_submit/get`

首批 capability：`deep_research`、`visualize`，随后加 `deep_question`。

## 5. 安全与裁剪

- [ ] Capability 白名单。
- [ ] 入参 JSON Schema 校验和长度限制。
- [ ] owner 注入，忽略客户端身份声明。
- [ ] A/B 账户隔离测试。
- [ ] 输出裁剪，大结果转 artifact。
- [ ] 不注册 `chat`、`exec`、文件路径、provider 配置工具。

## 6. 测试

- [ ] stdio initialize/tools/list。
- [ ] research/visualization job 提交、轮询、取消。
- [ ] 幂等重复提交。
- [ ] artifact owner 隔离。
- [ ] stdout 无污染。
- [ ] Postgres/MinIO 集成测试。
