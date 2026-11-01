# T1 — 本地 stdio MCP + Postgres/MinIO 最小闭环

## 目标

新增 DeepTutor 对外 MCP Server 的第一个可运行版本：通过 stdio 被本地 MCP 客户端调用，使用 Postgres 持久化账户作用域数据，使用 MinIO/S3 存储产物，并先开放研究与可视化等轻量异步能力。

## 前置依赖

- T0 已冻结工具契约、错误码和作业状态机。

## 范围

### 1. 本地基础设施

新增或完善 `docker-compose.yml`：

- Postgres；
- MinIO；
- 可选 Redis。

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

首批开放能力：

- `deep_research` → 研究报告；
- `visualize` → SVG/Mermaid/Chart.js/HTML 产物。

暂不开放：

- 裸 `chat`；
- `exec`；
- 视频课；
- Manim 数学动画；
- 音频微课。

### 4. Postgres-only 仓储与 Alembic

建立 SQLAlchemy 2.x + asyncpg + Alembic。

T1 至少包含：

- `jobs`
- `job_events`（如需）
- `artifacts`
- `usage_events`
- 本地开发用账户/测试账户表，或复用 T2 前的最小 auth stub

所有业务表包含：

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

- [ ] `deeptutor mcp serve --transport stdio` 可启动。
- [ ] MCP 客户端能列出工具。
- [ ] `deep_research` job 可提交、查询、取消。
- [ ] `visualize` job 可生成 artifact。
- [ ] 重复 `capability_run_submit` 使用同一幂等键返回同一 job。
- [ ] A/B 两个账户互不可见 job 和 artifact。
- [ ] 所有业务读写命中 Postgres/MinIO，不新增 `.sqlite3`。
- [ ] stdout 无日志污染。
- [ ] 集成测试在真实 Postgres 容器中通过。
- [ ] 进程连续启动 3 次无端口、事件总线或上下文泄漏。

## 非目标

- 不做公网 HTTP MCP。
- 不做 OAuth 登录。
- 不做支付和真实订阅。
- 不做 WorkBuddy 市场发布。
- 不做重媒体能力。

