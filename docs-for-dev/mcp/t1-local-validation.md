# T1 本地验证记录

> 日期：2026-11-01  
> 分支：`feat/workbuddy-mcp-goals`

## 1. 基础设施

```bash
docker compose -f deploy/docker-compose.postgres-minio.yml up -d postgres redis
```

- Postgres：`postgres:17-alpine`，端口 `5432`，healthy。
- Redis：`redis:7-alpine`，容器内 6379，宿主机映射 `6380:6379`（本机 6379 已被 redis-server 占用）。
- S3 兼容存储：MinIO 官方镜像在当前 Docker 凭据环境下拉取被拒绝；已改用可拉取的 `localstack/localstack:4.0` 在 4566 端口验证 S3 put/get/presign，compose 中保留可选 `s3` profile。

## 2. Alembic

```bash
DATABASE_URL=postgresql+asyncpg://deeptutor:deeptutor@127.0.0.1:5432/deeptutor   .venv/bin/alembic upgrade head
```

结果：迁移 `0001_mcp_jobs_artifacts_usage` 成功。

## 3. 单元/集成测试

```bash
.venv/bin/python -m pytest tests/mcp_server tests/services/jobs -q
DATABASE_URL=postgresql+asyncpg://deeptutor:deeptutor@127.0.0.1:5432/deeptutor   .venv/bin/python -m pytest tests/services/jobs/test_postgres_job_service.py -q
```

结果：

- 无 `DATABASE_URL`：6 passed，2 skipped。
- 有 `DATABASE_URL`：Postgres Job/Artifact/Usage/幂等/取消测试通过。

## 4. stdio MCP 协议联调

确定性 runner：

```bash
DEEPTUTOR_MCP_DETERMINISTIC=1 .venv/bin/python scripts/mcp_stdio_smoke.py
```

真实 Turn runner：

```bash
.venv/bin/python scripts/mcp_stdio_smoke.py
```

真实 Turn runner + Postgres：

```bash
DATABASE_URL=postgresql+asyncpg://deeptutor:deeptutor@127.0.0.1:5432/deeptutor   .venv/bin/python scripts/mcp_stdio_smoke.py
```

结果：MCP initialize/tools/list/tools/call 成功；`visualize` job 成功并返回 artifact；带 Postgres 的作业在 `jobs`/`artifacts` 表中可查询。

确定性 runner + Postgres + LocalStack S3：

```bash
DATABASE_URL=postgresql+asyncpg://deeptutor:deeptutor@127.0.0.1:5432/deeptutor \
S3_ENDPOINT=http://127.0.0.1:4566 S3_BUCKET=deeptutor-dev \
S3_ACCESS_KEY_ID=test S3_SECRET_ACCESS_KEY=test \
  .venv/bin/python scripts/mcp_stdio_deterministic_smoke.py
```

结果：MCP 协议、Postgres 作业元数据、S3 artifact put/get/presign 全部成功，输出短期 LocalStack URL。

## 5. 长任务取消

```bash
DATABASE_URL=postgresql+asyncpg://deeptutor:deeptutor@127.0.0.1:5432/deeptutor   .venv/bin/python scripts/mcp_stdio_research_cancel.py
```

结果：`deep_research` job 提交后可取消，最终状态为 `canceled`。

## 6. 出题能力 CLI Spike

```bash
.venv/bin/python -m deeptutor_cli.main run deep_question   '根据二次函数知识点出 3 道中文选择题。' --language zh --format json
```

结果：命令成功，产生结构化 `qa_pair`；本次实际生成 1 道题，耗时约 6 分钟，证明出题必须走异步 Job，不能做 MCP 同步工具。

## 7. 已知阻塞/限制

- 当前 Docker 环境拒绝拉取 MinIO 官方镜像；T1 的对象存储协议适配已存在，单元测试使用内存对象存储，Postgres 中保存 artifact 元数据。
- T1 的真实多 worker Job 领取尚未实现；当前 PostgresJobService 是单 MCP 进程内 asyncio task + Postgres 持久化，符合本地 stdio 最小闭环，多实例领取放到 T2/T3。
- `TurnCapabilityRunner` 当前从 result envelope 提取可视化 artifact；更多媒体能力在 T4 接入。
