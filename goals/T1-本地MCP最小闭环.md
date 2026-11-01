# T1 — 本地 stdio MCP 最小闭环

> Codex goal-mode target：完成本目标时，必须交付“产出物”中的文件/代码，并按“验收命令”运行测试，留下可审查证据。


## 目标

新增 DeepTutor 对外 MCP Server 的第一个可运行版本：通过 stdio 被本地 MCP 客户端调用，使用本地 Postgres/S3-compatible object storage 支撑开发闭环，并先开放研究与可视化等轻量异步能力；完整历史 SQLite 数据迁移和生产多账户仓储在 T2 完成。

## 前置依赖

- T0 已冻结工具契约、错误码和作业状态机。

代码、迁移、测试和部署文件的放置位置见 [DIRECTORY_LAYOUT.md](./DIRECTORY_LAYOUT.md)。

## 范围

### 1. 本地基础设施

新增或完善 `docker-compose.yml`：

- Postgres；
- MinIO；
- Redis。

要求：

- 开发者执行一次 `docker compose up -d` 后可启动全部依赖；
- 新 MCP 运行路径不创建任何业务 `.sqlite3`；
- CI 可使用等价 Postgres service container。

### 2. MCP 命令

新增：

```bash
deeptutor mcp serve --transport stdio
```

要求：

- stdout 只输出 MCP 协议内容；
- 日志写 stderr 或文件；
- 不使用 `maybe_run()`；
- 容器/应用上下文单例；
- 进程退出时释放资源；
- 支持冷启动重复调用。

### 3. 元信息与作业原语

实现：

- `capabilities_list`
- `capability_run_submit`
- `capability_job_get`
- `capability_job_cancel`
- `capability_job_reply`
- `artifact_get`
- `quiz_generate_submit` / `quiz_generate_job_get`（P1 末，异步）

首批开放能力：

- `deep_research` → 研究报告；
- `visualize` → SVG/Mermaid/Chart.js/HTML 产物；
- P1 末增加 `quiz_generate_submit/get` → 异步出题/题单，不做阻塞同步生成。

暂不开放：

- 裸 `chat`；
- `exec`；
- 视频课；
- Manim 数学动画；
- 音频微课；
- 解题/判分/掌握度写操作（T3/T4）。

### 4. Postgres-only 仓储与 Alembic

建立 SQLAlchemy 2.x + asyncpg + Alembic。

T1 至少包含开发闭环所需最小表：

- `jobs`
- `job_events`（如需）
- `artifacts`
- `usage_events`
- 本地 dev/test 账户 stub

完整 `users/auth_identities/subscriptions/sessions/practice/mastery` 生产仓储在 T2 建立。

T1 新建表包含：

- `owner_user_id`；
- 合适复合索引；
- `(owner_user_id, idempotency_key)` 唯一约束；
- `created_at` / `updated_at timestamptz`。

### 5. Artifact 存储

- 研究报告、HTML、图片、导出文件写 MinIO/S3；
- 数据库只存元数据、MIME 类型、对象 key 和大小；
- `artifact_get` 返回短期 URL 或受控下载响应；
- 不返回服务器绝对路径。

### 6. MCP 安全边界

- 每个工具都有白名单；
- 入参做长度、类型、枚举和 JSON schema 校验；
- 输出截断；
- artifact 必须校验 owner；
- 不接受任意服务器文件路径；
- 不开放 provider 配置；
- 不开放通用 shell。

### 7. 本地客户端联调

- 用 MCP Inspector 或等效客户端验证工具发现；
- 用 `~/.workbuddy/mcp.json` 做一次本地配置验证（不要求上架）；
- 验证研究/可视化任务“提交 → 轮询 → 取产物链接”。

## 产出物

- `deeptutor/mcp_server/`（或等价模块）
- `deeptutor_cli` MCP 子命令
- Alembic 初始迁移
- Docker Compose 依赖
- MCP Server 单元/集成测试
- Postgres 集成测试
- 本地联调记录

## 完成标准

- [x] `deeptutor mcp serve --transport stdio` 可启动。
- [x] MCP 客户端能列出工具。
- [x] `deep_research` job 可提交、查询、取消。
- [x] `visualize` job 可生成 artifact。
- [x] 重复 `capability_run_submit` 使用同一幂等键返回同一 job。
- [x] A/B 两个账户互不可见 job 和 artifact。
- [x] T1 新增的 job/artifact/usage 读写命中 Postgres/S3-compatible object storage，不新增业务 `.sqlite3`。
- [x] stdout 无日志污染。
- [x] 集成测试在真实 Postgres 容器中通过。
- [x] 进程连续启动 3 次无端口、事件总线或上下文泄漏。

## Codex 实施任务

1. 新建 `deeptutor/mcp_server/` 和 `deeptutor_cli/mcp.py`，实现 stdio transport。
2. 配置 SQLAlchemy 2.x + asyncpg + Alembic，创建 jobs/artifacts/usage 等初始迁移。
3. 提供 Postgres + MinIO 的开发 compose，不创建业务 SQLite。
4. 实现 `capabilities_list`、`capability_run_submit/get/cancel/reply`、`artifact_get`。
5. 将研究/可视化 Capability 接入 `TurnApplicationService`，以 Job 方式执行。
6. 完成 owner 注入、幂等键、输出裁剪、错误码、stdout/stderr 隔离。
7. 编写 MCP stdio、Postgres repository、MinIO artifact、账户隔离和幂等测试。

## 验收命令/证据

```bash
docker compose -f deploy/docker-compose.postgres-minio.yml up -d
DATABASE_URL='postgresql+asyncpg://...' alembic upgrade head
python -m deeptutor_cli.main mcp serve --transport stdio
python -m pytest tests/mcp_server tests/services/jobs tests/services/storage -q
# 使用 MCP Inspector 或脚本完成 initialize/tools/list/tools/call
# 验证运行目录没有新增业务 .sqlite3
find . -name '*.sqlite3' -newer deploy/docker-compose.postgres-minio.yml -print
```

必须保留测试输出、MCP Inspector 截图/日志、A/B 账户隔离测试记录。

## 非目标

- 不做公网 HTTP MCP。
- 不做 OAuth 登录。
- 不做支付和真实订阅。
- 不做 WorkBuddy 市场发布。
- 不做重媒体能力。

