# T3 — 云端多账户 streamable HTTP 服务

> Codex goal-mode target：完成本目标时，必须交付“产出物”中的文件/代码，并按“验收命令”运行测试，留下可审查证据。


## 目标

把 T1 的本地 stdio MCP 升级为可被 WorkBuddy、千问办公、豆包等外部宿主通过网络访问的多账户服务，完成注册登录、账户隔离、Postgres 托管、对象存储、额度计量和安全审计，达到外部试用标准。

## 前置依赖

- T1 本地 stdio 闭环通过。
- T2 PostgreSQL 多账户存储改造通过。

## 范围

### 1. Streamable HTTP MCP

新增：

```bash
deeptutor mcp serve --transport http --host 0.0.0.0 --port 8001
```

端点：

```text
/mcp
/healthz
/readyz
```

要求：

- TLS 在反向代理层终结；
- 支持标准 MCP HTTP/SSE 传输；
- 连接级鉴权；
- 请求体大小限制；
- 限流；
- 统一错误格式；
- 可观测 trace/request id。

### 2. 多账户与 OAuth 2.1

首版按个人学习者多账户实现，不建组织租户。

需要：

- 注册/登录页面或托管 Auth 配置；
- 邮箱/手机号/第三方 OAuth 中至少一种可运行路径；
- access token；
- refresh/session 轮换；
- token 可吊销；
- MCP 首次无 token 返回 401 + 登录/授权 URL；
- Skill 不接触用户名密码。

令牌解析后注入：

- `user_id`；
- `workspace_id`；
- `owner_user_id`；
- 套餐/额度上下文。

### 3. Postgres 产品化与云端配置

使用托管 Postgres 或等价生产环境：

- PITR；
- 自动备份；
- HA/只读副本按阶段规划；
- 连接池；
- 迁移流程；
- RLS 作为纵深防御；
- 应用层强制 owner 谓词。

复用并校验 T2 已建立的核心表：

- `users`
- `auth_identities`
- `subscriptions`
- `jobs`
- `artifacts`
- `practice_*`
- `mastery_*`
- `review_tasks`
- `usage_events`

### 4. 对象存储

- S3 兼容对象存储；
- 私有 bucket；
- 短期签名 URL；
- artifact 生命周期策略；
- 上传/下载大小限制；
- MIME 类型校验。

### 5. 学习状态与 P2 能力开放

在 T2 PostgreSQL 仓储就绪后，开放学习状态工具：

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
- `mastery_path_generate_*` 与必要的掌握度写操作

要求：

- 每个资源都校验 owner；
- review 使用幂等 request id；
- 掌握度更新必须有证据和事件；
- 写操作重复提交不得重复计分。

在 T1 的研究、可视化和异步出题基础上，开放方案 P2 能力：

- `problem_solve_submit/get`：映射 `deep_solve`，分步解题与同类练习；
- `quiz_judge_submit/get`：主观题/图片题异步判分；
- `audio_overview_generate_submit/get`：映射 `audio_overview`，生成音频与逐字稿；
- `quiz_generate_*`：沿用 T1 的异步出题 Job，不做阻塞同步工具。

要求：

- 解题、判分、音频均为 Job，不伪装成同步阻塞工具；
- 提交前说明成本/耗时（音频和模型调用）；
- 判分结果仅作为形成性反馈，不代表官方评分；
- 所有写操作必须幂等并写入 `usage_events`。

### 7. 套餐、额度与计量

实现最小商业化能力：

- 免费/试用/付费 plan；
- 每日或每月额度；
- 按能力计量：对话、研究、出题、媒体、token、artifact；
- 超额错误码；
- `usage_events` 汇总；
- 管理端只读查看（内部运营即可）。

### 8. 审计与风控

记录：

- 账户 ID；
- 工具名；
- 请求 ID；
- job ID；
- 资源 ID；
- 结果状态；
- 用量；
- 错误码。

不记录：

- 密钥；
- 完整敏感答案（如法律/政策要求需另设计）；
- provider 凭据。

### 9. 上线与回滚演练

- 复用 T2 的 SQLite ETL 和备份恢复能力；
- 云端使用托管 Postgres（PITR/HA）和对象存储；
- 准备蓝绿/回滚配置；
- 新云端运行路径不打开 SQLite。

## 产出物

- HTTP MCP Server
- OAuth/账户服务接入
- 生产配置样例
- 托管 Postgres/对象存储部署文档
- 配额与计量模块
- 账户隔离测试
- 备份恢复演练记录

## 完成标准

- [x] `/mcp` 可通过 HTTPS 反向代理访问（streamable HTTP；nginx/Caddy 示例在 `deploy/`，TLS 在代理层终结）。
- [x] 未认证调用返回标准 401 流程（`WWW-Authenticate: Bearer` + 登录/注册 URL；`/v1/auth/*` 注册/登录/轮换/吊销）。
- [x] 两个不同账户无法读取彼此 job、artifact、practice、mastery 数据（HTTP 集成测试 + RLS 策略双重验证）。
- [x] 幂等重试不重复扣额度、不重复计分（`quota_ledger` 唯一键：`job:<id>` / `practice:<owner>:<request_id>`；练习台账重放返回首次结果）。
- [x] 超额调用被正确拒绝并给出升级提示（429 `QUOTA_EXCEEDED` + upgrade_url，免费版 media=3 测试覆盖）。
- [x] Postgres 备份可在干净环境恢复（0003 schema `pg_dump -Fc` → 新库：6 张新表、20 条 RLS 策略、版本号一致）。
- [x] 对象存储链接短期有效且不能越权访问（900 秒预签名；B 账户取 A 产物返回 NOT_FOUND；MIME/大小校验）。
- [x] 新业务路径无 SQLite 写入（T2 `test_platform_no_sqlite` 持续有效；HTTP 仅复用同一平台层）。
- [x] 关键接口具备限流（20/120 次/分钟）、审计（`audit_events`）和 request id（`X-Request-ID` 响应头）。
- [x] 至少完成一次真实外部宿主联调（`scripts/mcp_http_smoke.py` 使用官方 `mcp.client.streamable_http` 客户端全流程通过）。

## 验证证据（2026-11-02）

```text
# 迁移
alembic upgrade head => 0003_auth_quota；base→head 全周期 downgrade/upgrade 通过
新增表：password_credentials / refresh_tokens / quota_counters /
        quota_ledger / audit_events / practice_ledger
RLS：20 张个人表 owner_isolation 策略；受限角色 deeptutor_app 实测隔离

# 测试（87 项，全部真实 Postgres/LocalStack）
pytest tests/services/{postgres,jobs,storage,auth,quota}        tests/learning/postgres tests/migration tests/mcp_server -q
=> 87 passed（含 HTTP 端到端 15 项：401/注册登录/刷新轮换盗用吊销/
   A-B 作业+产物+练习+掌握路径隔离/额度超限/限流/请求体上限/审计/request id）

# 真实外部宿主联调（官方 streamable HTTP MCP 客户端）
scripts/mcp_http_smoke.py =>
  401 flow / register-login / refresh rotation + reuse revoke /
  authenticated MCP job + artifact / cross-account isolation /
  learning-state tools  => status=passed

# stdio 回归
mcp_stdio_deterministic_smoke / mcp_stdio_research_cancel 通过

# 备份恢复
pg_dump -Fc → 新库 pg_restore：auth_tables=6、rls_policies=20、
alembic_version=0003_auth_quota，源/恢复一致

# 闸门：ruff check/format、check_architecture、import-linter（3 契约）、git diff --check
```

## Codex 实施任务

1. 在 MCP server 中实现 streamable HTTP `/mcp`，保留 stdio transport。
2. 接入 OAuth 2.1/Bearer 鉴权，实现 401 + 登录 URL、token 轮换与吊销。
3. 扩展 Postgres schema：账户、订阅、practice/mastery、quota/usage。
4. 将 artifact 切换到云端 S3 兼容存储和短期签名 URL。
5. 实现套餐额度、限流、审计、request id、统一错误格式。
6. 准备生产部署配置、备份恢复与健康检查文档。
7. 仅在明确宿主需要时增加 SSE transport，不提前维护无需求兼容层。

## 验收命令/证据

```bash
DATABASE_URL='postgresql+asyncpg://...' S3_ENDPOINT='...' python -m deeptutor_cli.main mcp serve --transport http --host 0.0.0.0 --port 8001
curl -i http://127.0.0.1:8001/healthz
curl -i http://127.0.0.1:8001/mcp
python -m pytest tests/mcp_server -q -k 'http or oauth or quota or owner or audit'
```

必须提供：HTTPS 反代配置、401 流程记录、A/B 账户越权测试、Postgres 恢复演练、额度超限测试。

## 非目标

- 不做 `immersive_reading` 实时会话、Remotion 视频课、Manim 动画（进入 T4）。
- 不做企业 SSO。
- 不做组织/席位/团队报表。
- 不做监考、证书或正式考试认证。
- 不承诺替代学校成绩或官方测评。

