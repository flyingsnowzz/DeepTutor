# T2 — PostgreSQL 多账户存储改造

> Codex goal-mode target：把 DeepTutor 新学习平台/MCP 所需的系统记录从 per-workspace SQLite/文件存储改造为 **PostgreSQL-only 的集中式多账户数据层**，并保留一次性 SQLite ETL 迁移路径。完成本目标后，新运行路径不得再创建或打开业务 SQLite。

## 目标

DeepTutor 当前代码默认使用大量 per-workspace SQLite 与文件存储（如 `mastery.sqlite3`、session、practice、task_board、reading、calendar、usage 等）。这无法支撑线上多账户、跨设备学习记录、订阅额度、Job/Artifact、水平扩容和统一备份。

本目标完成：

1. 建立 PostgreSQL 作为唯一关系型系统库；
2. 建立多账户数据隔离基础（`owner_user_id`）；
3. 新建集中式 Job/Artifact/Usage/账户订阅模型；
4. 把首批学习状态（session、practice、mastery）改造成 Postgres 仓储；
5. 提供从遗留 SQLite 到 Postgres 的一次性 ETL；
6. 让 DeepTutor 自有 App/Web/API 与 MCP Server 共用同一数据层。

## 前置依赖

- T0 已冻结 MCP 工具契约、Job 状态机、账户与数据边界。
- 已确认首个线上环境使用 PostgreSQL，不保留 SQLite/Postgres 双实现。

## 范围

### 1. 技术栈与基础设施

采用：

- PostgreSQL 15+；
- SQLAlchemy 2.x；
- asyncpg；
- Alembic；
- S3 兼容对象存储（MinIO/云厂商）；
- Redis 仅用于队列、限流、协调，不作为权威存储。

新增本地开发环境：

```text
deploy/docker-compose.postgres-minio.yml
deploy/env/postgres.example.env
```

要求本地开发和 CI 都启动真实 Postgres，不用 SQLite 模拟集成行为。

### 2. 仓储边界

为现有存储建立 port/repository 边界，优先改造高频核心域：

- session / turn；
- practice / question bank；
- mastery / learning evidence；
- job / artifact；
- accounts / subscription / usage。

原则：

- 业务服务不直接拼 SQLite SQL；
- MCP、REST、WebSocket 不直接访问数据库；
- 所有个人数据查询都带 `owner_user_id`；
- Postgres RLS 可作为纵深防御，但不替代应用层校验。

### 3. 初始数据模型

至少建立以下表（具体字段以 Alembic 迁移为准）：

#### 账户与订阅

- `users`
- `auth_identities`
- `subscriptions`

#### 会话与 Turn

- `sessions`
- `turns`
- `turn_events`
- `model_turns` / 私有模型历史表（如需要）

#### Job 与产物

- `jobs`
- `job_events`（如需要）
- `artifacts`

#### 学习状态

- `mastery_paths`
- `mastery_interactions`
- `mastery_events`
- `practice_entries`
- `practice_reviews`
- `review_tasks`

#### 计量

- `usage_events`

### 4. 多账户隔离

所有个人数据表必须包含：

```text
owner_user_id
```

并建立合适索引，例如：

```text
(owner_user_id, updated_at DESC)
(owner_user_id, next_due_at)
(owner_user_id, idempotency_key) UNIQUE
```

要求：

- 资源 ID 不能作为唯一授权依据，必须联合 owner 校验；
- 应用层所有查询都强制 owner 谓词；
- 可启用 Postgres RLS：连接内设置 `app.user_id`，策略使用 `owner_user_id`；
- 测试必须覆盖 A 用户不能读取 B 用户的 session、job、artifact、practice、mastery 数据。

### 5. Job / Artifact / Usage

为后续 MCP HTTP 服务提前建立平台能力：

- Job 状态：`queued / running / needs_input / succeeded / failed / canceled`；
- 幂等：`(owner_user_id, idempotency_key)` 唯一；
- Artifact 元数据入库，二进制文件放对象存储；
- `artifact_get` 通过 owner 校验后返回短期签名 URL；
- usage 记录能力、token、成本、模型、请求来源和账户。

### 6. 遗留 SQLite ETL

提供一次性迁移工具：

```text
scripts/migration/sqlite_to_postgres/
```

迁移来源包括：

- `learning/mastery.sqlite3`
- session/practice 相关 SQLite
- workspace registry（如目标模型需要）

迁移要求：

- 按 workspace 属主映射 `owner_user_id`；
- 幂等 upsert；
- 记录迁移批次、来源路径、校验和、数量；
- 支持 dry-run；
- 支持按账户核对记录数；
- 迁移后只保留只读排障工具，不保留运行时 SQLite 回退。

### 7. 自有产品与 MCP 共用

DeepTutor 自有 App/Web/SDK 应直接使用应用服务/仓储，不走 MCP；MCP Server 也调用同一应用服务。

目标结构：

```text
First-party Web/App/SDK  ──┐
                           ├── TurnApplicationService / Domain Services ─── PostgreSQL
External MCP Server ───────┘                                              └── Object Storage
```

### 8. CI 与本地开发

- 新增 Postgres service container/testcontainers；
- 集成测试必须跑真实 Postgres；
- 新增测试禁止使用 SQLite 作为新仓储的兼容替身；
- 检查新 MCP/SaaS 路径运行后不产生业务 `.sqlite3`。

## 产出物

```text
alembic.ini
alembic/
deploy/docker-compose.postgres-minio.yml
deploy/env/postgres.example.env
deeptutor/services/storage/postgres*
deeptutor/services/jobs/
deeptutor/services/accounts/
deeptutor/services/practice/postgres.py（或等价仓储）
deeptutor/learning/storage_postgres.py（或等价仓储）
scripts/migration/sqlite_to_postgres/
tests/services/postgres/
tests/services/jobs/
tests/learning/postgres/
docs-for-dev/mcp/postgres-storage.md
```

## Codex 实施任务

1. 增加 SQLAlchemy/asyncpg/Alembic 依赖和数据库配置读取。
2. 编写初始 Alembic 迁移，建立账户、Job、Artifact、Usage、session、practice、mastery 核心表。
3. 实现 Postgres 仓储与 owner 隔离，不复制业务逻辑。
4. 将 Job/Artifact/Usage 服务切换到 Postgres/对象存储。
5. 将 practice/mastery/session 的新平台路径切换到 Postgres 仓储。
6. 增加本地 Postgres/MinIO compose 和示例环境变量。
7. 编写 SQLite → Postgres dry-run/执行/校验 ETL。
8. 增加真实 Postgres 集成测试、跨账户访问测试和幂等测试。
9. 更新开发/部署文档，明确 SQLite 仅作为遗留迁移来源。

## 验收命令/证据

```bash
docker compose -f deploy/docker-compose.postgres-minio.yml up -d
DATABASE_URL='postgresql+asyncpg://...' alembic upgrade head
python scripts/migration/sqlite_to_postgres/migrate.py --dry-run
python scripts/migration/sqlite_to_postgres/migrate.py --execute
python -m pytest tests/services/postgres tests/services/jobs tests/learning -q
python -m pytest tests/mcp_server -q -k 'owner or idempotency or artifact'
```

必须提供：

- Alembic 升级/回滚结果；
- A/B 账户隔离测试结果；
- ETL dry-run 和执行后的账户级计数核对；
- Postgres 备份/恢复演练记录；
- 新路径不生成业务 `.sqlite3` 的检查结果。

## 完成标准

- [x] `alembic upgrade head` 可在空 Postgres 成功建表（0001→0002；`downgrade base` 后重建验证通过，0002 downgrade 会原样恢复 0001 schema）。
- [x] 所有个人数据表均有 `owner_user_id` 外键和必要索引（owner+updated_at / owner+status / owner+due_at / owner+idempotency_key UNIQUE 等）。
- [x] Job 幂等、Artifact 授权、Usage 记录有测试覆盖（`tests/services/jobs/test_postgres_job_service.py`）。
- [x] practice/mastery/session 新平台路径读写 Postgres（`PostgresPracticeRepository` / `PostgresMasteryRepository` / `PostgresSessionStore`，由 `deeptutor/services/platform.py::PlatformDataServices` 聚合）。
- [x] A/B 账户无法互读学习记录、作业和产物（`tests/services/postgres/*`、`tests/learning/postgres/*`；显式跨属主 ID 写入抛 `PermissionError`）。
- [x] SQLite ETL 可 dry-run、可执行、可核对、可重跑（`tests/migration/test_sqlite_to_postgres.py`；批次/校验和记入 `migration_batches`）。
- [x] 新 SaaS/MCP 运行路径不创建业务 SQLite（`tests/mcp_server/test_platform_no_sqlite.py`）。
- [x] 本地开发和 CI 使用真实 Postgres（`.github/workflows/tests.yml` 新增 `postgres-integration` job，postgres:16-alpine service + `alembic upgrade head`）。
- [x] DeepTutor 自有入口与 MCP 入口复用同一服务/仓储层（`mcp_server/factory.py` 在 `DATABASE_URL` 存在时构建 `PlatformDataServices`）。
- [x] 文档明确 Postgres 是唯一关系型系统库（`docs-for-dev/mcp/postgres-storage.md`、`deploy/env/postgres.example.env`）。

## 验证证据（2026-11-01）

```text
# 迁移全周期：base → 0001 → 0002 → 0001 → base → 0002 成功
alembic current => 0002_platform (head)

# 真实遗留数据 ETL（重跑可对账、可增量）
sessions=18 turns=30 turn_events=17976（Postgres 属主 legacy_62ec… 计数一致）
turn 状态：succeeded 13 / failed 9 / cancelled 8
migration_batches：每来源 1 行（sha256 + counts，重跑 upsert）

# 测试
pytest tests/services/postgres tests/services/jobs tests/services/storage        tests/learning/postgres tests/migration tests/mcp_server -q
=> 53 passed
pytest tests/mcp_server -q -k 'owner or idempotency or artifact' => 1 passed, 5 deselected

# stdio MCP → Postgres → S3 冒烟
scripts/mcp_stdio_deterministic_smoke.py => succeeded + S3 预签名 URL
scripts/mcp_stdio_research_cancel.py    => canceled

# 备份/恢复演练：pg_dump -Fc → 新库 pg_restore，逐表计数一致，
# alembic_version=0002_platform（详见 docs-for-dev/mcp/postgres-storage.md §8）
```

## 非目标

- 不做组织租户、班级、席位和团队报表。
- 不把所有历史文件型知识库/RAG 索引一次性迁移到关系库。
- 不重写全部 DeepTutor 历史模块，只迁移新平台/MCP 首批必需路径。
- 不用 Redis 替代关系型数据库。
- 不保留 SQLite/Postgres 双运行时。
