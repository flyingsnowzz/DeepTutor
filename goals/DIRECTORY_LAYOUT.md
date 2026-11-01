# 开发产出物目录规划

> 适用范围：WorkBuddy/外部宿主 MCP 集成、DeepTutor 多账户云端服务、Postgres/对象存储、Skill 包和测试文档。  
> 原则：**生产代码进 Python/前端标准包；Skill 作为独立资产；设计文档进 `docs-for-dev/`；一次性脚本进 `scripts/`；测试进 `tests/`；运行时数据不进 Git。**

## 1. 顶层目录总览

```text
DeepTutor/
├── deeptutor/                     # Python 主包：生产代码
│   ├── mcp_server/                # 新增：对外 MCP Server（T1/T2）
│   ├── app/                       # 既有：应用门面与 durable turn
│   ├── runtime/                   # 既有：TurnEngine / Orchestrator / Registry
│   ├── core/                      # 既有：核心协议
│   ├── services/
│   │   ├── mcp/                   # 既有：MCP 客户端，不与 mcp_server 混淆
│   │   ├── jobs/                  # 新增：通用 Job/Artifact 应用服务
│   │   ├── accounts/              # 新增/承接：多账户、订阅、额度、OAuth 适配
│   │   └── storage/               # 对象存储适配
│   ├── learning/                  # 既有：掌握度学习内核
│   ├── modules/                   # 既有：模块 manifest / lifecycle
│   └── ...
├── deeptutor_cli/                 # CLI 命令
│   └── mcp.py                     # 新增：deeptutor mcp serve ...
├── alembic/                       # 新增：Postgres 数据库迁移
│   ├── versions/
│   └── env.py
├── workbuddy-skills/              # 新增：WorkBuddy Skill 源文件（T4）
│   └── deeptutor-learning/
├── docs-for-dev/                  # 设计、架构、契约、运维文档
├── goals/                         # 多目标开发计划与验收
├── deploy/                        # 部署、compose、环境模板
├── scripts/
│   ├── mcp/                       # MCP/Postgres 开发辅助脚本
│   ├── migration/                 # SQLite → Postgres ETL 工具
│   └── release/                   # 打包/发布辅助
├── tests/
│   ├── mcp_server/                # MCP Server 测试
│   ├── services/
│   │   ├── jobs/
│   │   ├── accounts/
│   │   └── storage/
│   └── workbuddy_skills/          # Skill frontmatter/安全扫描测试
└── web/                           # 自有产品 Web，不通过 MCP
```

## 2. 各目标产出物位置

## T0 — 契约冻结与本地 Spike

| 产出物 | 放置位置 | 说明 |
| --- | --- | --- |
| MCP 工具契约 | `docs-for-dev/mcp/tool-contracts.md` | 每个工具的入参、出参、错误码、示例 |
| Job 状态机 | `docs-for-dev/mcp/job-state-machine.md` | queued/running/needs_input/terminal states |
| 错误码 | `docs-for-dev/mcp/error-codes.md` | MCP 层错误，不泄露内部堆栈 |
| Skill 草稿 | `docs-for-dev/workbuddy-skill-draft.md` | T0 只草稿，不作为上架包 |
| Spike 脚本 | `scripts/mcp/spike/` | 只用于验证，不进生产路径 |
| Spike 结果 | `docs-for-dev/mcp/spike-results.md` | 记录能力、耗时、字段、失败模式 |

T0 不写生产 MCP Server，不创建会被运行时导入的占位模块。

## T1 — 本地 stdio MCP + Postgres/MinIO

### 2.1 生产代码

```text
deeptutor/mcp_server/
├── __init__.py
├── server.py                 # FastMCP 实例、工具注册、生命周期
├── transport.py              # stdio/http 启动参数与传输适配
├── auth.py                   # T1 本地开发鉴权/stub；T2 替换为 OAuth/Bearer
├── context.py                # MCP 请求上下文：user/workspace/owner_user_id
├── guards.py                 # 白名单、参数校验、输出裁剪、审计入口
├── errors.py                 # MCP 错误模型与错误码映射
├── tools/
│   ├── __init__.py
│   ├── meta.py               # capabilities_list
│   ├── jobs.py               # capability_run_submit/get/cancel/reply
│   ├── artifacts.py          # artifact_get
│   ├── practice.py           # practice_*
│   └── mastery.py            # mastery_* / review_tasks_list
└── schemas/
    ├── jobs.py
    ├── artifacts.py
    ├── practice.py
    └── mastery.py
```

CLI 放在：

```text
deeptutor_cli/mcp.py
```

命令：

```bash
deeptutor mcp serve --transport stdio|http
```

### 2.2 Job / Artifact / 账户服务

```text
deeptutor/services/jobs/
├── __init__.py
├── service.py                # 创建、查询、取消、needs_input、幂等
├── repository.py             # 仓储接口
├── postgres.py               # Postgres 实现
├── models.py
└── artifacts.py              # artifact_ref 与对象存储交互

deeptutor/services/accounts/
├── __init__.py
├── models.py
├── service.py
└── postgres.py

deeptutor/services/storage/
├── object_store.py           # S3/MinIO 协议
├── s3.py
└── presign.py
```

T1 可用最小 dev account stub；T2 再接真实 OAuth/账户体系。

### 2.3 数据库迁移

```text
alembic.ini
alembic/
├── env.py
├── script.py.mako
└── versions/
    └── 0001_initial_mcp_jobs_artifacts_usage.py
```

迁移必须包含：

- `jobs`
- `artifacts`
- `usage_events`
- T1 所需账户 stub 或账户关联表
- `owner_user_id`
- 幂等唯一约束
- 复合索引
- 更新时间触发器（如采用）

### 2.4 本地依赖

```text
deploy/docker-compose.dev.yml
deploy/docker-compose.postgres-minio.yml
deploy/env/mcp.example.env
```

如沿用根目录 compose，也要把真实服务定义集中到 `deploy/`，根 compose 只做兼容入口。

### 2.5 测试

```text
tests/mcp_server/
├── test_stdio_server.py
├── test_tool_discovery.py
├── test_jobs_tools.py
├── test_artifact_tools.py
├── test_owner_isolation.py
└── test_idempotency.py

tests/services/jobs/
├── test_job_service.py
└── test_job_repository_postgres.py

tests/services/storage/
└── test_object_store.py
```

Postgres 集成测试使用真实 Postgres 容器，不用 SQLite 代替。

## T2 — PostgreSQL 多账户存储改造

### 生产代码与迁移

```text
alembic.ini
alembic/
├── env.py
├── script.py.mako
└── versions/
    ├── 0001_core_accounts_jobs_artifacts.py
    ├── 0002_sessions_turns.py
    ├── 0003_practice_mastery.py
    └── 0004_quota_usage.py

deeptutor/services/
├── accounts/
│   ├── models.py
│   ├── service.py
│   └── postgres.py
├── jobs/
│   ├── models.py
│   ├── service.py
│   ├── repository.py
│   └── postgres.py
├── storage/
│   ├── object_store.py
│   ├── s3.py
│   └── presign.py
├── practice/
│   └── postgres.py
└── session/
    └── postgres.py

deeptutor/learning/
└── storage_postgres.py

scripts/migration/sqlite_to_postgres/
├── migrate.py
├── readers.py
├── checksums.py
└── verify.py
```

### 本地与测试

```text
deploy/docker-compose.postgres-minio.yml
deploy/env/postgres.example.env

tests/services/postgres/
tests/services/jobs/
tests/services/accounts/
tests/services/storage/
tests/learning/postgres/
```

Postgres 集成测试使用真实 Postgres 容器，不用 SQLite 代替。

## T3 — 云端多账户 streamable HTTP 服务

### 新增/修改

```text
deeptutor/mcp_server/
├── transport.py              # 增加 streamable HTTP
├── auth.py                   # OAuth 2.1/Bearer 解析
├── quota.py                  # 套餐与额度
├── audit.py                  # 审计事件
└── middleware.py             # request id、限流、错误格式
```

部署与环境：

```text
deploy/cloud/mcp.Dockerfile
deploy/cloud/env.production.example
deploy/cloud/nginx.example.conf
```

测试：

```text
tests/mcp_server/
├── test_http_mcp.py
├── test_oauth_401_flow.py
├── test_quota_enforcement.py
├── test_rate_limit.py
└── test_audit_logging.py
```

文档：

```text
docs-for-dev/mcp/cloud-deployment.md
docs-for-dev/mcp/oauth-and-multi-account.md
docs-for-dev/runbooks/postgres-backup-restore.md
```

stdio transport 必须保留；SSE 仅在外部宿主明确要求时增加。

## T4 — 教学媒体能力

MCP 工具放在：

```text
deeptutor/mcp_server/tools/
├── solve.py
├── reading.py
├── quiz.py
├── judge.py
├── audio.py
├── video.py
└── math_animation.py
```

按能力复用现有模块，不新建平行实现：

| 能力 | 现有主体 | MCP 工具位置 |
| --- | --- | --- |
| 解题 | `deeptutor/capabilities/solve` / agents | `deeptutor/mcp_server/tools/solve.py` |
| 精读 | `deeptutor/capabilities/reading` | `deeptutor/mcp_server/tools/reading.py` |
| 出题 | `deeptutor/agents/question` | `deeptutor/mcp_server/tools/quiz.py` |
| 判分 | `learning/semantic_assessment`、quiz judge | `deeptutor/mcp_server/tools/judge.py` |
| 音频 | `deeptutor/capabilities/audio_overview` | `deeptutor/mcp_server/tools/audio.py` |
| 视频课 | `deeptutor/agents/video_lesson` | `deeptutor/mcp_server/tools/video.py` |
| 数学动画 | `deeptutor/agents/math_animator` | `deeptutor/mcp_server/tools/math_animation.py` |

原则：

- MCP tool 只做参数转换、权限校验和结果裁剪；
- 不复制解题、研究、出题、渲染逻辑；
- 长任务一律进入 Job Service；
- 媒体产物统一进对象存储。

## T5 — WorkBuddy Skill 包

Skill 源文件统一放在：

```text
workbuddy-skills/
└── deeptutor-learning/
    ├── SKILL.md
    ├── references/
    │   ├── mcp-tools.md
    │   ├── job-flow.md
    │   ├── learning-workflows.md
    │   ├── output-style.md
    │   ├── safety-and-boundaries.md
    │   └── troubleshooting.md
    ├── templates/
    │   ├── study-plan-template.md
    │   ├── quiz-summary-template.md
    │   └── mastery-report-template.md
    └── examples/
        ├── solve-problem.md
        ├── reading-session.md
        ├── quiz-practice.md
        └── media-generation.md
```

构建/打包产物不要提交到 Git：

```text
dist/workbuddy-skills/
└── deeptutor-learning-0.1.0.zip
```

如需脚本：

```text
scripts/release/build_workbuddy_skill_zip.py
scripts/release/validate_workbuddy_skill.py
```

测试：

```text
tests/workbuddy_skills/
├── test_skill_frontmatter.py
├── test_skill_security_scan.py
└── test_skill_references.py
```

## 3. 文档放置规则

| 文档类型 | 路径 |
| --- | --- |
| 总体产品/集成方案 | `docs-for-dev/WorkBuddy集成方案.md` |
| 多目标计划 | `goals/` |
| MCP 工具契约 | `docs-for-dev/mcp/tool-contracts.md` |
| MCP 错误码 | `docs-for-dev/mcp/error-codes.md` |
| Job/Artifact 设计 | `docs-for-dev/mcp/job-and-artifact-service.md` |
| OAuth/多账户 | `docs-for-dev/mcp/oauth-and-multi-account.md` |
| 云端部署 | `docs-for-dev/mcp/cloud-deployment.md` |
| Skill 设计说明 | `docs-for-dev/workbuddy-skill-design.md` |
| Skill 真正上架源文件 | `workbuddy-skills/deeptutor-learning/` |
| Postgres/对象存储设计 | `docs-for-dev/mcp/postgres-storage.md` |

## 4. 不应该提交的内容

以下内容只允许存在于本地、CI secret 或云环境：

```text
.env
.env.local
*.sqlite3
data/
dist/
node_modules/
真实 token / cookie / API key
私有教材、真题、机构讲义
下载的第三方视频/音频
```

Skill 包中禁止出现：

- 真实 `DEEPTUTOR_TOKEN`；
- 生产数据库连接串；
- 任意 shell 脚本执行说明；
- `exec` 工具；
- 服务器绝对路径；
- 未授权教材/真题内容。

## 5. 命名约定

### Python

- MCP 工具函数使用 snake case；
- 对外 MCP 工具名使用小写 + 下划线：`capability_run_submit`；
- Job/Artifact ID 使用带前缀字符串或 UUID；
- service 层不依赖 FastMCP；
- FastMCP 只出现在 `deeptutor/mcp_server/` 边界。

### 数据库

- 表名使用复数蛇形命名：`jobs`、`artifacts`、`usage_events`；
- 所有个人数据表必须有 `owner_user_id`；
- 公共内容表与个人学习表分开；
- 外部 ID 字段建索引；
- 幂等键唯一约束必须带 owner 范围。

### Skill

- 目录名：`deeptutor-learning`；
- `name`：`deeptutor-learning`；
- 版本：`0.1.0`；
- 面向用户展示“DeepTutor 全学段 AI 学习助手”。

## 6. 最小落地顺序

第一批只创建这些路径，避免过度设计：

```text
deeptutor/mcp_server/
deeptutor_cli/mcp.py
deeptutor/services/jobs/
alembic/
deploy/docker-compose.postgres-minio.yml
docs-for-dev/mcp/
tests/mcp_server/
```

T5 开始前再创建：

```text
workbuddy-skills/deeptutor-learning/
tests/workbuddy_skills/
```

不要提前创建大量空目录；每个目录必须随第一个真实产出物一起出现。
