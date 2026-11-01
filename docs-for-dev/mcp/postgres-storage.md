# PostgreSQL 多账户数据层（T2）

> 目标文件：`goals/T2-PostgreSQL多账户存储改造.md`
>
> 从 T2 起，**PostgreSQL 是新学习平台 / MCP 路径唯一的关系型系统库**。SQLite 仅作为一次性 ETL 迁移来源；Redis 只做队列/限流/协调；产物二进制放 S3 兼容对象存储，Postgres 只存元数据。

## 1. 本地基础设施

```bash
# PostgreSQL 17 + Redis + LocalStack(S3)；加 --profile minio 可同时启 MinIO
docker compose -f deploy/docker-compose.postgres-minio.yml up -d

cp deploy/env/postgres.example.env deploy/env/postgres.env   # 本地不提交
# 或直接 export：
export DATABASE_URL='postgresql+asyncpg://deeptutor:deeptutor@127.0.0.1:5432/deeptutor'
export S3_ENDPOINT='http://127.0.0.1:4566' S3_BUCKET='deeptutor-dev'
export S3_ACCESS_KEY_ID='test' S3_SECRET_ACCESS_KEY='test' S3_REGION='us-east-1'
```

注意：宿主机 6379 若已被占用，compose 把容器 Redis 映射到 **6380**。

依赖（mcp-server extra，见 `pyproject.toml` 与 `requirements/mcp.txt`）：SQLAlchemy 2.x、asyncpg、Alembic、boto3。

## 2. 迁移（Alembic）

```bash
alembic upgrade head     # 当前 head：0002_platform
alembic downgrade base   # 仅本地开发使用
alembic current
```

| 版本 | 内容 |
| --- | --- |
| `0001_mcp_jobs` | T1 临时 jobs/artifacts/usage（已被 0002 替换） |
| `0002_platform` | users / auth_identities / subscriptions / sessions / turns / turn_events / jobs / artifacts / usage_events / practice_entries / practice_reviews / mastery_paths / mastery_interactions / mastery_events / migration_batches |

`alembic_version.version_num` 为 `varchar(32)`，revision id 使用短名（`0002_platform`）。

## 3. 数据模型与多账户隔离

- 所有个人数据表都有 `owner_user_id` 外键；典型索引：
  - `(owner_user_id, updated_at DESC)`（列表）
  - `(owner_user_id, status)`（作业筛选）
  - `(owner_user_id, next_due_at/due_at)`（复习到期）
  - `(owner_user_id, idempotency_key) UNIQUE`（作业幂等）
  - `(turn_id, seq) UNIQUE`（turn 事件顺序）
- **资源 ID 不能单独授权**：所有仓储查询都带 `owner_user_id` 谓词；
  mastery path / practice entry 的显式 ID 写入会先校验属主，跨属主写入抛
  `OwnershipError`/`PracticeOwnershipError`（`PermissionError` 子类）。
- RLS 作为后续纵深防御（连接内 `SET LOCAL app.user_id` + policy），不替代应用层校验。

## 4. 代码布局与共享服务层

```text
deeptutor/services/postgres/database.py     # engine / sessionmaker（读 DATABASE_URL）
deeptutor/services/accounts/service.py      # AccountService: ensure_user / 订阅引导 / plan
deeptutor/services/session/postgres_store.py# PostgresSessionStore
deeptutor/services/practice/postgres.py     # PostgresPracticeRepository
deeptutor/learning/storage_postgres.py      # PostgresMasteryRepository（path/event/interaction）
deeptutor/services/jobs/postgres.py         # PostgresJobService（提交即引导 owner 账户）
deeptutor/services/platform.py              # PlatformDataServices：单一 engine 聚合全部仓储
deeptutor/services/storage/s3.py            # S3ObjectStore（产物二进制 + 预签名 URL）
scripts/migration/sqlite_to_postgres/       # 一次性 ETL
```

第一方 App/Web/SDK 直接使用 `PlatformDataServices` / 各应用服务；**只有外部宿主
（WorkBuddy、千问办公、豆包等）经 skill 走 MCP**。`deeptutor/mcp_server/factory.py`
在 `DATABASE_URL` 存在时构建的是同一套 `PlatformDataServices`，传输不同、数据层相同：

```text
First-party Web/App/SDK  ──┐
                           ├── PlatformDataServices / Domain Services ── PostgreSQL
External MCP (stdio/HTTP) ─┘                                          └── S3 兼容对象存储
```

仓储约定：`AccountService.ensure_user()` 负责账户生命周期；其它仓储假定
`owner_user_id` 已完成认证与引导（例如 `PostgresJobService.submit()` 内部会先
`_ensure_owner`，保证外键可解析）。

## 5. Job / Artifact / Usage

- 状态机：`queued / running / needs_input / succeeded / failed / canceled`。
- 幂等：相同 `(owner_user_id, idempotency_key)` 返回同一 job。
- artifact 元数据入库，二进制写对象存储，`artifact_get` 经属主校验后返回短期预签名 URL（默认 900 秒）。
- usage_events 记录 provider/model/token/成本，按 owner 与 job 关联。

## 6. SQLite → PostgreSQL ETL

```bash
python scripts/migration/sqlite_to_postgres/migrate.py --dry-run          # 只读、报数
python scripts/migration/sqlite_to_postgres/migrate.py --execute --check  # upsert + 对账
```

来源（`DEEPTUTOR_HOME`，默认 `data/user`）：

- `chat_history.db`：sessions / turns / turn_events；
  `notebook_entries` → `practice_entries`；
  `practice_review_state`（SRS 状态，含 due_at/interval/ease/streak…）→
  `practice_reviews`，并用最新一条 `practice_review_events` 覆盖 rating/answer；
- `workspace/learning/mastery/mastery.sqlite3`：mastery_paths / interactions / events。

特性：

- 时间戳统一转 UTC aware `datetime`（asyncpg 对 `timestamptz` 的要求）；
- 遗留状态映射：turn `completed → succeeded`，`failed/cancelled` 原样保留；
- 每个来源按路径哈希得到稳定 owner（`legacy_<sha256[:16]>`），也可用 `--owner` 显式指定；
- 全部使用确定性 ID + upsert，**可安全重跑**；
- 孤儿 turn/event/interaction 自动跳过并计数，不违反外键；
- 每次执行在 `migration_batches` 记录属主、来源类型、路径、sha256、各表数量；
- ETL 不提供运行时 SQLite 回退。

真实数据迁移对账（2026-11-01，本机，多次执行的最近一次）：

| 表 | SQLite 来源 | Postgres（属主 legacy_62ec…） |
| --- | --- | --- |
| sessions | 18 | 18 |
| turns | 30 | 30 |
| turn_events | 17976 | 17976 |
| turns 状态 | completed 13 / failed 9 / cancelled 8 | succeeded 13 / failed 9 / cancelled 8 |

（首次迁移时为 16/28/17968；此后本地 App 又新增 2 个 cancelled 会话，重跑 ETL 后
Postgres 与来源再次一致——证明 upsert 可随来源增量重跑。）`migration_batches` 始终
保持每来源一行（ON CONFLICT 刷新 checksum/数量/时间），无重复 `(turn_id,seq)`。

## 7. 测试

真实 Postgres / LocalStack S3，**不用 SQLite 冒充新仓储**（未设置 `DATABASE_URL` 时集成测试 skip）：

```bash
pytest tests/services/postgres tests/services/jobs tests/services/storage \
       tests/learning/postgres tests/migration tests/mcp_server -q
pytest tests/mcp_server -q -k 'owner or idempotency or artifact'
```

覆盖：账户引导幂等、session/practice/mastery 的 A/B 属主隔离、幂等写入、
Job 幂等/取消、artifact 属主授权、usage 落库、ETL 全生命周期、以及
`tests/mcp_server/test_platform_no_sqlite.py`（隔离 `DEEPTUTOR_HOME` 下跑完整平台
路径后不产生任何 `*.sqlite*`）。

## 8. 备份 / 恢复演练记录（2026-11-01）

在运行中的开发库（含真实迁移数据）上执行：

```bash
docker exec deeptutor-mcp-postgres pg_dump -U deeptutor -Fc deeptutor > deeptutor-drill.dump
docker cp deeptutor-drill.dump deeptutor-mcp-postgres:/tmp/
docker exec deeptutor-mcp-postgres psql -U deeptutor -d postgres \
  -c "CREATE DATABASE deeptutor_restore_drill;"
docker exec deeptutor-mcp-postgres pg_restore -U deeptutor \
  -d deeptutor_restore_drill --no-owner /tmp/deeptutor-drill.dump
```

源库与恢复库逐表对账一致：`jobs=6，migration_batches=2，sessions=32，
turn_events=17968，turns=28，users=62`；恢复库 `alembic_version=0002_platform`。
演练后已删除演练库与转储文件。生产建议：每日 `pg_dump -Fc`（或 WAL/PITR）+ 加密异地存储，
恢复演练至少每季度一次；S3 桶启用版本化与独立备份策略。
