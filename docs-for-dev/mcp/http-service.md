# 云端多账户 Streamable HTTP 服务（T3）

> 目标文件：`goals/T3-云端多账户HTTP服务.md`
>
> T3 把 T1 的 stdio MCP 升级为可被 WorkBuddy、千问办公、豆包等宿主通过网络访问的多账户服务。第一方 App/Web/SDK 仍直接调用应用服务，**只有外部宿主走 MCP**。

## 1. 端点

| 端点 | 方法 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `/mcp` | POST/GET/DELETE | Bearer access token | MCP streamable HTTP（SSE 响应流） |
| `/healthz` | GET | 无 | 存活探针 |
| `/readyz` | GET | 无 | 就绪探针（检查 Postgres 连通） |
| `/v1/auth/register` | POST | 无 | 邮箱+密码注册 |
| `/v1/auth/login` | POST | 无 | 登录，签发 access + refresh |
| `/v1/auth/refresh` | POST | 无 | refresh 轮换（旧令牌立即失效） |
| `/v1/auth/revoke` | POST | refresh token | 主动吊销 |
| `/v1/billing/plans` | GET | 无 | 公开套餐与额度目录 |

启动：

```bash
DATABASE_URL=... S3_ENDPOINT=... DEEPTUTOR_JWT_SECRET=$(openssl rand -hex 32) \
  python -m deeptutor_cli.main mcp serve --transport http --host 0.0.0.0 --port 8001
# 本地无 LLM 联调加 DEEPTUTOR_MCP_DETERMINISTIC=1；本地临时密钥 DEEPTUTOR_ALLOW_DEV_SECRET=1
```

## 2. 注册登录与令牌（邮箱密码可运行路径）

Skill/宿主**不接触用户名密码**：引导用户在浏览器打开注册/登录页，拿到令牌后注入 Authorization 头。

```bash
curl -X POST https://host/v1/auth/register -H 'content-type: application/json' \
  -d '{"email":"a@example.com","password":"至少8位"}'
curl -X POST https://host/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"a@example.com","password":"..."}'
# -> {access_token(HS256 JWT, 1h), refresh_token(不透明, 30d), token_type, expires_in}
```

- access token 声明：`sub / workspace_id / owner_user_id / plan / email / jti / iss / exp`；
- refresh 轮换：每次 refresh 旧令牌写 `revoked_at` 并指向 `replaced_by`；
  **已轮换/吊销的令牌被再次使用（疑似盗用）会吊销该账户全部 refresh 令牌**，必须重新登录；
- refresh 令牌只存 sha256 哈希；密码用 bcrypt（cost=12，超长密码先 sha256 折叠）；
- `/mcp` 无 token 或 token 无效返回：

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="deeptutor-mcp", error="missing_token"
{"ok":false,"data":null,"error":{"code":"UNAUTHENTICATED",
 "details":{"login_url":".../v1/auth/login","register_url":".../v1/auth/register"}}}
```

后续第三方 OAuth/OIDC（微信/Google/飞书）通过 `auth_identities(provider, subject)`
接入同一账户模型，属于增量工作，不改变 MCP 边界。

## 3. 传输安全与网关

- TLS 在反向代理终结（见 `deploy/nginx/deeptutor-mcp.conf.example`、
  `deploy/caddy/Caddyfile.example`，Caddy 自动签证书）；
- 请求体上限默认 1 MiB（`MCP_REQUEST_MAX_BYTES`），产物上限 50 MiB（
  `MCP_ARTIFACT_MAX_BYTES`）；
- 限流：进程内滑动窗口，凭据接口默认 20 次/分/IP、`/mcp` 120 次/分/IP
  （`MCP_RATE_LIMIT_*_PER_MINUTE`）；水平扩容时换成 Redis 实现；
- 每个响应带 `X-Request-ID`（未提供则服务端生成 `req_*`），审计按它串联。

## 4. 多账户隔离（两层）

1. **应用层**：所有仓储查询都带 `owner_user_id` 谓词；显式 ID 写入先校验属主，
   跨属主抛 `OwnershipError`；资源 ID 不能单独授权。
2. **Postgres RLS（纵深防御）**：0003 在全部个人表上启用 `owner_isolation` 策略
   （`owner_user_id = current_setting('app.user_id', true)`）。生产用受限角色
   `deeptutor_app`（`deploy/postgres/init/01_app_role.sql`）连接：未设置 GUC 时
   看不到任何行，伪装成其他用户的写入被拒绝。迁移/本地开发用表 owner 角色（绕过 RLS）。

## 5. 套餐、额度与计量

`deeptutor/services/quota/plans.py` 定义 free/trial/pro 与按日/月的 metric 上限。

能力 → metric：`deep_research→research`、`visualize→visualization`、
`deep_question→question`、`problem_solve→solve`、`quiz_judge→judge`、
`audio_overview→media`、`mastery_path→mastery`；练习判题/复习 → `practice`。

- submit 前 `assert_allowed`，超限返回 429 `QUOTA_EXCEEDED`（带 upgrade_url），
  不创建作业；
- 计量在作业**成功终止后**幂等写入：`quota_ledger.idempotency_key = job:<job_id>`
  唯一，重试/重复回调绝不重复扣减；练习写操作以 `practice:<owner>:<request_id>` 幂等；
- 汇总表 `quota_counters(owner, day/month, metric)` 实时累计，
  `practice_summary_get` 同时返回额度摘要；`usage_events` 保留 token/成本明细。

## 6. 作业型 P2 能力

全部为异步 Job（不提供阻塞同步工具），submit 返回计费说明（meter/charged_on）：

| 工具 | 能力 |
| --- | --- |
| `problem_solve_submit/get` | `deep_solve` 分步解题与同类练习 |
| `quiz_judge_submit/get` | 主观题/图片题异步判分（结果仅形成性反馈，不代表官方评分） |
| `audio_overview_generate_submit/get` | 音频导学（含逐字稿产物；真实媒体管线在 T4） |
| `quiz_generate_submit/get`、`mastery_path_generate_submit/get` | T1 出题、掌握路径生成 |

学习状态工具全部 owner 校验：`practice_summary_get / practice_queue_list /
practice_question_get / practice_answer_check / practice_review_submit /
practice_entries_list / practice_entry_bookmark / review_tasks_list /
mastery_paths_list / mastery_map_get / mastery_objective_get`。

- `practice_answer_check`：确定性判分（选择/填空），写错题 SRS 行（again 立即到期）、
  `practice_ledger` 幂等台账；题目挂掌握路径时同步写 `mastery_interactions` +
  `question_answered` 事件（证据）。
- `practice_review_submit`：again/hard/good/easy 的 SM-2-lite 调度，同一 request_id
  重放返回首次结果。

## 7. 对象存储

沿用 T2 的 S3 兼容存储：私有桶、二进制入库对象存储、元数据入库 Postgres、
`artifact_get` 校验 owner 后签发 900 秒 URL。0003 起对产物做 MIME 白名单
（text/image/audio/video + pdf/json，拒绝 html/svg 等可执行内容）与大小校验。
桶侧建议开启版本化与生命周期规则（例如 `tmp/` 前缀 7 天过期）。

## 8. 审计

`audit_events` 记录：request_id、账户、工具名、job/资源 ID、状态、错误码、粗粒度用量、
IP。不记录密码、provider 凭据与完整答案文本（练习内容保存在业务表，审计只留结果标志）。

## 9. 验证证据（2026-11-02）

```text
pytest tests/mcp_server/http tests/services/auth tests/services/quota \
       tests/services/postgres/test_rls_isolation.py ...   # 全绿
scripts/mcp_http_smoke.py:
  401 flow / register-login / refresh rotation + reuse revoke /
  authenticated MCP job + S3 artifact / cross-account isolation /
  learning-state tools  => status=passed（官方 mcp streamable_http 客户端）
```

备份恢复见 `postgres-storage.md` §8；新路径不写业务 SQLite（T2 回归测试持续有效）。

## 10. 部署、托管依赖与回滚

### 10.1 Postgres（生产）

- 使用云厂商托管 Postgres 15+：开启**自动备份 + PITR**；试用阶段单实例 + 每日
  `pg_dump -Fc` 异地留存，GA 前规划 HA 与只读副本；
- 应用以受限角色 `deeptutor_app` 连接（`deploy/postgres/init/01_app_role.sql`），
  迁移 job 使用表 owner 角色；RLS 因此始终生效；
- 连接池：SQLAlchemy 已 `pool_pre_ping=True`；多副本时经 pgbouncer（transaction
  pooling）或云厂商连接池接入，避免每进程直连耗尽连接；
- 上线流程：`alembic upgrade head`（0003 全部 DDL 事务化），应用随后滚动发布；
- 回滚：先回应用（蓝绿切流），确需回退 schema 时执行 `alembic downgrade -1`
  （0003 downgrade 会恢复 0002 形态），回退前用 PITR/快照兜底。

### 10.2 对象存储

- 私有桶 + 桶策略拒绝匿名访问；开启版本化；`tmp/` 等前缀配置生命周期（如 7 天过期）；
- 密钥通过环境变量/密钥管理下发，禁止写入镜像或仓库；
- CDN 仅用于非敏感公开素材；学习产物一律走 900 秒预签名 URL。

### 10.3 服务进程与蓝绿

- 进程无状态：水平多副本 + 负载均衡；本地限流为进程内滑动窗口，扩副本后换 Redis 实现；
- 蓝绿：两套环境共用同一托管 Postgres（schema 向后兼容时直接切流），健康检查
  `/healthz`（进程存活）与 `/readyz`（DB 连通）分开用于编排探针；
- 关键配置：`DEEPTUTOR_JWT_SECRET`（≥32 字符，openssl rand -hex 32）轮换时旧 access
  token 自然过期（1 小时），refresh 哈希在库无需迁移密钥（轮换 JWT secret 只影响新发 access）。

### 10.4 最小生产环境变量

见 `deploy/env/mcp.example.env`、`deploy/env/postgres.example.env`。最小集合：
`DATABASE_URL`（deeptutor_app 角色）、`S3_*`、`DEEPTUTOR_JWT_SECRET`、
`DEEPTUTOR_PUBLIC_BASE_URL=https://...`、`DEEPTUTOR_TOKEN_ISSUER`。
