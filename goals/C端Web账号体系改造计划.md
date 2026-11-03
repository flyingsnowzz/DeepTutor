# DeepTutor C 端 Web 账号体系改造计划

> 状态：待评审、待实施  
> 整理日期：2026-11-03  
> 依据：当前源码静态审阅；本文是改造方案，不代表功能已经实现。  
> 目标：把当前适合本地和管理员邀请制的 DeepTutor Web，改造成可以安全提供给 C 端用户使用的多账号 Web 应用。

## 1. 结论先行

DeepTutor **已经具备多用户基础，不需要从零开发账号体系**，但当前主 Web 还不能直接作为开放注册的 C 端产品上线。

当前代码中存在两套不同用途的账号实现：

1. **主 Web 账号体系**：支持登录、管理员创建用户、角色、学习者档案和按用户隔离工作区，但默认关闭认证，公开注册只用于创建第一个管理员，账号主要保存在 JSON 文件中。
2. **云端 MCP 账号体系**：已经具备 PostgreSQL 用户、邮箱密码凭据、刷新令牌轮换、订阅、额度、审计和 RLS 等基础，但它服务于外部 MCP 宿主，不是主 Web 的完整账号体系。

因此，正确方向不是再写第三套注册登录，而是：

- 保留主 Web 现有的 `CurrentUser`、角色、学习权限和工作区隔离；
- 以 PostgreSQL 账户模型作为长期身份存储；
- 复用云端已有的刷新令牌、订阅和额度能力；
- 为主 Web 增加公开注册、邮箱验证、找回密码、会话撤销和账号自助管理；
- 先完成邀请制私测，再开放公开注册，最后接支付和商业化。

**第一步不是修改注册页面，而是先冻结统一身份模型和账号存储方案。**

## 2. 产品目标与边界

### 2.1 本期目标

- 用户可以通过邮箱注册、验证、登录和退出。
- 用户可以找回密码、修改密码、管理自己的登录会话。
- 管理员可以创建、导入、禁用、删除用户并调整角色。
- 每个用户的会话、知识库、记忆、笔记本、学习记录和凭据按账号隔离。
- 免费用户和付费用户可以有不同的使用额度，超额后能被可靠拦截。
- 支持 HTTPS 公网部署，并具备基本的限流、审计、备份和恢复能力。

### 2.2 首版不做

- 组织架构、团队席位和企业 SSO。
- 复杂代理商、分销和多级租户。
- 自建完整支付系统。
- 把所有本地文件和 SQLite 学习数据一次性迁完；账号迁移与学习数据迁移应分阶段实施。
- 让主 Web 通过 MCP 调用自身能力。主 Web 继续走 `TurnApplicationService`，MCP 只作为外部宿主适配层。

## 3. 当前已经有什么

### 3.1 主 Web 已有能力

| 能力 | 当前状态 | 主要源码入口 |
| --- | --- | --- |
| 登录、退出、状态查询 | 已有；使用 JWT Cookie | `deeptutor/api/routers/auth.py`、`web/lib/auth.ts` |
| 注册 | 仅第一个管理员可自助注册，之后关闭 | `deeptutor/api/routers/auth.py` 的 `register()` |
| 管理员创建用户 | 已有 | `deeptutor/api/routers/auth.py` 的 `admin_create_user()` |
| 用户导入、删除、角色调整 | 已有 | 同文件的 `/users/import`、`/users/batch-delete`、`/users/{username}/role` |
| 角色 | `admin / teacher / student / user`；只有 `admin` 提升管理权限 | `deeptutor/multi_user/models.py` |
| 账号预设 | `standard / learner / custom` | `deeptutor/multi_user/models.py` |
| 管理后台 | 已有 `/admin/users` | `web/app/(admin)/admin/users/page.tsx` |
| 用户头像、学习者档案 | 已有 | `deeptutor/api/routers/auth.py`、`deeptutor/multi_user/identity.py` |
| 监护人和学习权限 | 已有 | `deeptutor/api/routers/multi_user.py`、`deeptutor/multi_user/learning_access.py` |
| 用户工作区隔离 | 普通用户位于 `data/users/<uid>` | `deeptutor/multi_user/paths.py`、`deeptutor/multi_user/context.py` |
| 知识库、技能、工具等授权 | 已有相应访问控制模块 | `deeptutor/multi_user/*_access.py` |
| 通用请求筛查 | 可选，默认关闭 | `deeptutor/api/security_guard.py`、`docs-for-dev/SECURITY_GUARD.md` |

### 3.2 云端 MCP 已有、主 Web 应复用的能力

| 能力 | 主要源码入口 | 改造时的用途 |
| --- | --- | --- |
| PostgreSQL 用户和身份 | `deeptutor/services/accounts/service.py` | 统一账号 ID 和订阅关系 |
| 邮箱密码注册、登录 | `deeptutor/services/auth/service.py` | 复用密码校验和账号创建逻辑 |
| Access/Refresh Token | `deeptutor/services/auth/service.py` | 主 Web 会话改造和令牌撤销 |
| Refresh Token 轮换与重放撤销 | `deeptutor/services/auth/service.py` | 防止刷新令牌被重复利用 |
| 数据库迁移 | `alembic/versions/0002_platform_accounts_learning_state.py`、`0003_auth_quota_audit_rls.py` | 复用 users、auth_identities、password_credentials、refresh_tokens 等表 |
| 订阅和套餐 | `deeptutor/services/accounts/service.py`、数据库 `subscriptions` | 免费/付费账号标识 |
| 配额计数与幂等扣费 | `deeptutor/services/quota/service.py` | 主 Web 调用前检查和调用后结算 |
| 审计和 RLS | `alembic/versions/0003_auth_quota_audit_rls.py` | 数据库层隔离与操作追踪 |
| MCP 注册登录 API | `deeptutor/mcp_server/http_app.py` | 只参考契约；不能直接当作主 Web 的完整登录方案 |

### 3.3 当前运行配置不安全用于公网

当前 `data/user/settings/auth.json` 的关键状态是：

```json
{
  "enabled": false,
  "cookie_secure": false
}
```

这意味着当前访问者会按本地管理员身份使用系统。**在该配置下不能直接暴露到公网。**

## 4. 缺什么，按优先级怎么排

| 优先级 | 缺口 | 当前问题 | 必须得到的结果 |
| --- | --- | --- | --- |
| P0 | 统一身份模型 | Web 的 `u_*` 用户与 MCP 的 `user_*` 用户是两套身份 | 同一个真人只有一个稳定 `user_id`，Web/MCP 不再各自映射一套账号 |
| P0 | 主 Web 数据库存储 | 主 Web 账号使用 `data/system/auth/users.json` | 账号、凭据和会话进入 PostgreSQL；并发写入和多实例可用 |
| P0 | 公网认证基线 | 当前认证关闭、Cookie 非 Secure | HTTPS、Secure Cookie、准确 CORS、受信代理和登录域限制完成 |
| P0 | 会话撤销 | 主 Web 退出主要删除浏览器 Cookie，旧 JWT 在过期前仍可能有效 | 改密、禁用、退出所有设备后，旧会话在服务端失效 |
| P0 | 跨账号安全验收 | 已有隔离代码，但不能据此推定所有 C 端路径安全 | API、WebSocket、文件、知识库、会话和产物均有 A/B 用户越权测试 |
| P1 | 公开注册策略 | 第一个管理员之后 `/register` 返回 403 | 支持 `closed / invite / open` 三种模式，并保持旧默认行为 |
| P1 | 邮箱验证 | 主 Web 没有完整验证流程 | 验证邮件、过期、重发、一次性 token、防枚举均可用 |
| P1 | 找回和修改密码 | 主 Web 缺少完整自助流程 | 找回密码、改密、改密后撤销旧会话可用 |
| P1 | 注册登录风控 | 通用 guard 不能替代账号专项风控 | 登录失败限制、注册限流、验证码/邀请码、邮件发送限制可配置 |
| P1 | 用户自助中心 | 当前主要是头像和学习者资料 | 用户可管理资料、密码、会话，并按产品规则申请注销 |
| P1 | 主 Web 配额执行 | MCP 有 QuotaService，主 Web 的 UsageTracker 主要记录用量 | 主 Web 在调用前预留、完成后结算，超额可靠阻断且不重复扣费 |
| P2 | 支付和订阅生命周期 | 有 plan/subscription 基础，但不是完整商业化 | 支付 webhook、续费、退款、宽限期、升降级和发票按所选支付商完成 |
| P2 | 规模化运维 | 单机和文件工作区仍有运维约束 | 备份恢复、监控告警、迁移回滚、多实例限流和任务恢复经过演练 |

## 5. 推荐目标架构

```text
浏览器
  │ HTTPS
  ▼
反向代理 / WAF / 公网限流
  ▼
Next.js Web + web/proxy.ts
  │ HttpOnly Secure Cookie / CSRF 或 Origin 校验
  ▼
DeepTutor API + WebSocket
  ├── Web 身份适配层
  │     ├── 统一 user_id / CurrentUser / role / preset
  │     ├── PostgreSQL AccountRepository
  │     └── SessionService（refresh 轮换、撤销、设备列表）
  ├── 账号自助服务
  │     ├── 注册 / 邀请 / 邮箱验证
  │     ├── 找回密码 / 修改密码
  │     └── 注销 / 导出（按产品合规要求）
  ├── 现有用户工作区与权限层
  │     ├── data/users/<uid>
  │     ├── workspace / knowledge / memory / notebook
  │     └── learning_access / tool_access / skill_access
  └── 配额与审计
        ├── 调用前 assert_allowed / reserve
        ├── 完成后按 turn_id 幂等 settle
        └── usage / cost / audit / admin report

PostgreSQL：用户、凭据、会话、订阅、额度、审计
邮件服务：验证邮件、找回密码、安全通知
对象存储：面向公网的文件和产物（按现有部署进度接入）
支付服务：P2 接入，不让支付 webhook 直接绕过账号与额度服务
```

### 必须坚持的架构决定

1. **一个用户只保留一个主键。** 不再新增 `web_user_id`、`mcp_user_id` 的永久双轨映射。
2. **Web Cookie 与 MCP Bearer 是两种传输方式，不是两套账号。** 两者最终解析到同一个 `CurrentUser`。
3. **数据库 RLS 不能替代文件路径授权。** `data/users/<uid>`、本地产物和 SQLite 工作区仍需要现有 scope 检查。
4. **兼容旧部署。** 不打开公开注册功能时，当前“第一个用户之后仅管理员创建”的行为必须保持不变。
5. **先迁移身份，再增加自助功能。** 不要在 JSON 用户存储上继续堆公开注册、邮箱 token 和支付逻辑。

## 6. 分阶段实施：具体做什么、从哪儿改

### P0-A：冻结身份契约和现状回归

#### 要做什么

- 写一篇简短 ADR，确定统一用户 ID、角色、账号状态、用户名/邮箱规则和 Web/MCP 关系。
- 明确旧数据映射：保留原 `u_*` ID 还是一次性映射到 `user_*`；优先考虑保留旧 ID，减少 `data/users/<uid>` 搬迁。
- 明确邮箱是否作为开放注册的唯一账号名；普通用户名仅保留给私有/邀请制部署。
- 先给现有邀请制注册、角色和隔离行为补契约测试，避免改造中改变默认行为。

#### 从哪里改

- 身份模型：`deeptutor/multi_user/models.py`
- 当前用户上下文：`deeptutor/multi_user/context.py`
- 账号读写：`deeptutor/multi_user/identity.py`
- PostgreSQL 用户：`deeptutor/services/accounts/service.py`
- 云端身份参考：`deeptutor/services/auth/service.py`
- 现有回归：`tests/multi_user/test_registration_invite_only.py`、`test_identity_and_paths.py`、`test_login_username_contract.py`

#### 验收

- ADR 中能明确回答“Web 登录后如何得到与 MCP 相同的 user_id”。
- 旧账号 ID、管理员角色、工作区路径、用户名大小写和禁用状态都有迁移规则。
- 未启用新功能时，现有测试全部通过。

### P0-B：建立主 Web 的 PostgreSQL 账号仓储

#### 要做什么

- 在身份层引入 `AccountRepository` 接口，不让 API 路由直接读写 JSON。
- 提供 PostgreSQL 实现；保留只读旧仓储用于迁移和回滚。
- 将用户、角色、preset、头像、禁用状态映射到统一模型。
- 使用 Alembic 增量迁移，不重写或删除现有云端表。
- 编写一次性 `users.json → PostgreSQL` 迁移工具，支持 dry-run、冲突报告、校验和回滚。

#### 建议新增位置

```text
deeptutor/services/accounts/
├── models.py              # 统一账号读写模型
├── repository.py          # AccountRepository 协议
├── postgres.py            # PostgreSQL 实现
└── legacy_import.py       # users.json 导入与冲突报告

scripts/migration/
└── import_web_accounts.py
```

#### 需要改造的现有调用点

- `deeptutor/multi_user/identity.py`：逐步把文件读写改为仓储调用。
- `deeptutor/services/auth/__init__.py`：认证逻辑改为调用账号服务，不再直接依赖 JSON。
- `deeptutor/api/routers/auth.py`：只处理 HTTP 契约，不承载存储细节。
- `alembic/versions/`：新增增量 revision。
- `deeptutor/services/config/runtime_settings.py`：数据库和迁移模式配置。

#### 验收

- 空数据库可执行 `alembic upgrade head`。
- 两个并发注册不能创建同一邮箱/用户名。
- 导入旧账号后，原用户仍看到自己的工作区和角色。
- 新路径不再写 `data/system/auth/users.json`。
- 数据库不可用时 fail closed，不能退回“本地管理员”。

### P0-C：先完成可公网的邀请制私测

#### 要做什么

- 开启认证，但保持公开注册关闭，由管理员创建测试账号。
- 全站 HTTPS；生产环境设置 `cookie_secure: true`。
- 配置精确 CORS origin、受信前端代理和允许登录的公开主机。
- 检查 Next.js proxy 与后端对认证开关的理解一致。
- 对登录、注册、找回等敏感响应设置 `Cache-Control: no-store`。
- 为启用 Cookie 的写请求补 Origin/CSRF 策略。
- 开启并验证通用 security guard；认证专项限流在 P1 继续补强。

#### 从哪里改

- 运行配置：`data/user/settings/auth.json`（真实密钥和运行配置不要提交到 Git）。
- 系统配置：`data/user/settings/system.json`。
- 默认配置和校验：`deeptutor/services/config/runtime_settings.py`。
- Cookie、登录主机和代理：`deeptutor/api/routers/auth.py`。
- 前端认证代理：`web/proxy.ts`、`web/lib/auth.ts`。
- 部署：`Dockerfile`、`compose.yaml`、`deploy/`、`docs-for-dev/CONTAINERIZATION.md`。

#### 验收

- 未登录用户不能访问受保护 API 和 WebSocket。
- 普通用户不能访问 `/admin/users` 及管理接口。
- HTTP 公网入口不可绕过 HTTPS；Cookie 带 `HttpOnly`、`Secure` 和正确 SameSite。
- 伪造 Host、X-Forwarded-*、跨域写请求和无效 Cookie 均被拒绝。
- 数据库故障不会导致认证被绕过。

### P0-D：服务端会话撤销和账号禁用

#### 要做什么

- 复用云端 refresh token 轮换与重放检测，不让主 Web 继续只依赖不可撤销的长期 JWT。
- 增加“退出当前设备”和“退出所有设备”。
- 修改密码、禁用账号、删除账号时撤销相关会话。
- Access token 保持短时有效；refresh token 只保存哈希，并设置绝对过期时间。
- 明确 WebSocket 在令牌过期和账号禁用时的断开策略。

#### 从哪里改

- 参考实现：`deeptutor/services/auth/service.py`。
- 主 Web token：`deeptutor/services/auth/__init__.py` 的 `create_token()`、`decode_token()`。
- 主 Web 登录/退出：`deeptutor/api/routers/auth.py` 的 `login()`、`logout()`、`require_auth()`。
- 前端会话管理：`web/app/(utility)/profile/page.tsx`、`web/lib/auth.ts`。
- 数据库：`refresh_tokens` 及必要的 session/device 字段。

#### 验收

- 退出所有设备后，旧 Cookie、Bearer token 和 WebSocket 均不能继续操作。
- refresh token 重放会撤销对应会话族并写安全审计。
- 禁用用户立即或在明确的短时限内失去访问权限。
- 改密后其他设备全部退出。

### P1-A：公开注册、邀请码和邮箱验证

#### 要做什么

- 把注册策略做成显式配置：`closed / invite / open`，默认保持 `closed`。
- `open` 模式只允许邮箱注册；`invite` 模式验证一次性或限量邀请码。
- 注册后不直接获得完整已验证状态，先发送验证邮件。
- 验证 token 使用随机高熵值，数据库只存哈希，单次使用并限时过期。
- 重发验证邮件要限流；注册和找回响应避免泄露邮箱是否已注册。
- 增加注册、登录和邮件发送的账号专项限流；多实例部署时使用共享限流存储。

#### 从哪里改

- 后端入口：`deeptutor/api/routers/auth.py` 的 `RegisterRequest`、`register()`。
- 账号创建：`deeptutor/services/accounts/`、`deeptutor/services/auth/service.py`。
- 邮件服务：建议新增 `deeptutor/services/notifications/email.py`。
- 数据表：新增 `email_verification_tokens`、`registration_invites`，或等价的统一一次性 token 表。
- 注册页面：`web/app/(auth)/register/page.tsx`。
- 前端 API：`web/lib/auth.ts`。
- 通用筛查：`deeptutor/api/security_guard.py`；不要把它当作完整验证码服务。

#### 建议接口

```text
POST /api/auth/register
POST /api/auth/verify-email
POST /api/auth/resend-verification
POST /api/auth/invites/validate        # invite 模式需要
GET  /api/auth/registration-policy     # 只暴露 UI 必需信息
```

#### 验收

- 默认配置下，原有 invite-only 测试不回归。
- open 模式可以完成注册、验证、登录完整链路。
- 验证链接不能重用，过期后失效，重发不会无限发送邮件。
- 同一 IP/邮箱的暴力注册和邮件轰炸会被限制。
- 并发注册、重复点击和请求重试不会创建重复账号。

### P1-B：找回密码、修改密码和账号自助中心

#### 要做什么

- 找回密码：输入邮箱后发送一次性限时链接，不泄露账号是否存在。
- 重置密码：校验 token、密码强度并撤销全部旧会话。
- 修改密码：要求当前密码，成功后发送安全通知。
- 个人中心：管理邮箱状态、密码、头像、学习者资料和登录设备。
- 注销账号：先定义延迟删除、数据导出、共享资源处理和不可恢复提示，再开放入口。

#### 建议新增位置

```text
deeptutor/services/accounts/recovery.py
deeptutor/services/accounts/sessions.py
web/app/(auth)/forgot-password/page.tsx
web/app/(auth)/reset-password/page.tsx
web/features/account/                 # 自助账号 API 与组件
```

现有入口：

- `web/app/(utility)/profile/page.tsx`
- `web/features/multi-user/api.ts`
- `deeptutor/api/routers/auth.py`

#### 建议接口

```text
POST /api/auth/forgot-password
POST /api/auth/reset-password
POST /api/auth/change-password
GET  /api/auth/sessions
DELETE /api/auth/sessions/{id}
POST /api/auth/logout-all
```

#### 验收

- 找回 token 单次、限时、只能改绑定账号的密码。
- 改密和重置后旧会话全部失效。
- 用户不能查询或删除其他用户的会话。
- 所有敏感操作只记录必要审计，不记录密码、完整 token 或 Cookie。

### P1-C：主 Web 配额、用量和成本保护

#### 要做什么

- 复用 `QuotaService` 和 `subscriptions`，不要重新发明一套额度表。
- 在模型或高成本能力执行前检查/预留额度，在执行后根据实际结果结算。
- 使用 `turn_id + capability + attempt` 等稳定幂等键，重试不能重复扣费。
- 明确文本、研究、图片、视频、Manim、Remotion、存储和下载分别使用什么 metric。
- 给前端返回剩余额度、重置时间和升级入口；超额错误不能表现为普通聊天失败。
- 管理后台增加用量和封禁原因查询，但不暴露其他用户隐私内容。

#### 从哪里改

- 现有配额：`deeptutor/services/quota/service.py`、`deeptutor/services/quota/plans.py`。
- 统一入口：`deeptutor/app/`、`deeptutor/runtime/orchestrator.py`。
- 当前用量统计：`deeptutor/runtime/agentic/usage.py`、`deeptutor/agents/_shared/capability_result.py`。
- 管理员接口：`deeptutor/api/routers/multi_user.py`。
- 前端账号/设置页：`web/app/(utility)/profile/`、`web/features/multi-user/`。

#### 验收

- 超额请求在产生模型费用前被拒绝。
- 同一 turn 重试、断线重放和重复事件不会重复扣费。
- 并发请求不会绕过剩余额度。
- 免费/付费套餐的日/月额度和剩余量显示一致。
- 失败、取消、部分成功时的退款或不计费规则有测试。

### P2：支付、订阅和正式运营

#### 要做什么

- 选择支付商后接入 checkout、customer portal 和 webhook。
- webhook 必须验签、持久化事件 ID 并幂等处理。
- 支付成功只通过账户服务更新 subscription，再由 QuotaService 读取 plan。
- 定义续费失败、退款、取消、宽限期、升降级和套餐到期的行为。
- 增加隐私政策、服务条款、数据导出/删除、备份恢复和安全告警。

#### 验收

- 重复 webhook 不重复升级或发放额度。
- 伪造 webhook 无效。
- 降级和到期不会误删学习数据，只会按规则限制新消耗。
- 备份恢复到干净环境后，账号、角色、套餐和学习数据关系一致。

## 7. 建议的数据模型补充

以下是需要覆盖的逻辑实体，不等同于要求全部新建表；应优先扩展现有 Alembic 模型。

| 实体 | 关键内容 | 说明 |
| --- | --- | --- |
| users | 统一 user_id、邮箱、状态、角色、时间戳 | 主 Web 与 MCP 共用主身份 |
| auth_identities | provider、subject、owner_user_id | 密码、OAuth 等身份归属 |
| password_credentials | 密码哈希、更新时间 | 复用现有表，不保存明文 |
| refresh_tokens | token hash、family、expiry、revoked/replaced | 复用现有轮换机制 |
| email_verification_tokens | user、token hash、expiry、used_at | 单次、限时、不可枚举 |
| password_reset_tokens | user、token hash、expiry、used_at | 成功后撤销会话 |
| registration_invites | code hash、次数、过期、邀请人 | invite 模式使用 |
| subscriptions | plan、status、period | 复用现有表 |
| quota_counters / quota_ledger | 周期用量、幂等扣费记录 | 复用现有表 |
| audit_events | actor、action、target、request_id、时间 | 不记录秘密和敏感正文 |

## 8. 前端改造清单

| 页面/模块 | 需要增加或调整的内容 |
| --- | --- |
| `web/app/(auth)/login/page.tsx` | 邮箱验证提示、找回密码、失败次数/稍后重试、通用错误 |
| `web/app/(auth)/register/page.tsx` | 根据 registration policy 展示关闭/邀请码/开放注册，不再只支持首管理员 |
| 新增 forgot/reset 页面 | 防枚举提示、token 失效、成功后的重新登录 |
| `web/app/(utility)/profile/page.tsx` | 修改密码、邮箱状态、登录设备、退出所有设备、用量和套餐 |
| `web/app/(admin)/admin/users/page.tsx` | 禁用/启用、重发验证、撤销会话、用量和邀请管理 |
| `web/lib/auth.ts` | 更新注册契约、会话恢复、401/403 区分和敏感错误处理 |
| `web/features/multi-user/` | 扩展账号管理类型与 API，避免把管理员功能暴露给普通用户 |
| 全局聊天/能力页面 | 展示未验证、超额、套餐到期等明确状态，不当作普通模型异常 |

## 9. 安全与数据隔离验收矩阵

| 场景 | 必须验证 |
| --- | --- |
| 未登录 | API、WebSocket、文件、管理页面都不能越权访问 |
| 普通用户 A 访问用户 B 资源 | 会话、知识库、记忆、笔记本、练习、产物、头像和设备均拒绝 |
| 管理员接口 | teacher/student/user 均不能调用；admin 操作有审计 |
| 伪造身份 | 篡改 Cookie、Bearer、user_id、workspace ID、Host、代理头均无效 |
| 注册攻击 | 重复邮箱、并发注册、垃圾注册、邮件轰炸、邀请码暴力尝试被处理 |
| 会话攻击 | token 重放、过期、改密、禁用、退出所有设备后无法继续使用 |
| 跨站请求 | 状态修改请求有 SameSite、Origin/CSRF 和准确 CORS 防护 |
| 文件与产物 | 不通过猜测路径、签名 URL 或 artifact ID 读取其他用户内容 |
| 配额竞争 | 并发、重试、断线和重放不能绕过额度或重复扣费 |
| 密钥与日志 | 日志、审计、异常和前端响应不包含密码、API Key、完整 token |
| 迁移与恢复 | 旧账号不丢角色/工作区；数据库恢复后权限不扩大 |

重点回归目录：

- `tests/multi_user/`
- `tests/api/test_auth_contextvar.py`
- `tests/api/test_auth_logout_cookie.py`
- `tests/api/test_cors_settings.py`
- `tests/api/test_security_guard.py`
- `tests/api/test_unified_ws_protocol.py`
- `tests/api/test_output_files.py`
- `tests/services/auth/`
- `tests/services/accounts/`
- `tests/mcp_server/http/`

## 10. 推荐 PR 拆分

1. **PR 1：身份 ADR + 现状契约测试**  
   只冻结用户 ID、角色、注册策略和迁移规则，不开放新注册。
2. **PR 2：AccountRepository + Alembic + JSON 导入工具**  
   完成主 Web 账号持久化，保持现有 UI 和邀请制行为。
3. **PR 3：生产认证配置 + 会话撤销 + 安全回归**  
   达到邀请制私测标准。
4. **PR 4：注册策略 + 邀请码 + 邮箱验证**  
   功能默认关闭，通过配置逐步开放。
5. **PR 5：找回/修改密码 + 用户会话中心**。
6. **PR 6：主 Web 配额接入 + 用量页面 + 幂等/并发测试**。
7. **PR 7：支付 webhook 和订阅生命周期**。
8. **PR 8：公网上线文档、备份恢复演练和监控告警**。

每个 PR 都应包含：变更文件、迁移说明、测试命令与结果、回滚方式、剩余风险。不要把数据库大迁移、公开注册和支付放在同一个 PR。

## 11. 现在最先做的三件事

### 第一件事：写统一身份 ADR

先确定 Web/MCP 共用的 `user_id`、旧账号 ID 保留策略、管理员角色存放位置、邮箱唯一规则和工作区路径是否变化。

### 第二件事：给当前邀请制和隔离行为补基线测试

至少覆盖：首管理员注册、后续公开注册被拒绝、管理员创建用户、普通用户不能管理他人、A/B 工作区不可互访、认证关闭时不能意外进入公网模式。

### 第三件事：实现 AccountRepository 和迁移 dry-run

先让主 Web 能通过统一接口读取 PostgreSQL 账号，并打印旧 `users.json` 的迁移冲突报告；确认报告无误后再切换写路径。

**只有这三步完成后，才应开始公开注册页面和邮件流程。**

## 12. 上线门槛

### 邀请制私测可上线

- 认证默认开启，公开注册关闭。
- HTTPS、Secure Cookie、CORS、代理和 CSRF/Origin 检查通过。
- 账号进入 PostgreSQL，旧账号迁移验证完成。
- 普通用户与管理员的 API/WS/文件隔离测试通过。
- 改密、禁用和退出所有设备能撤销会话。
- 有基本配额、审计、备份和恢复方案。

### 公开注册可开放

- 邀请制私测问题已处理。
- 邮箱验证、找回密码、注册登录限流和防邮件轰炸通过测试。
- 用户协议、隐私政策、账号注销和数据处理流程明确。
- 垃圾注册、密码喷洒、token 重放和并发配额测试通过。
- 监控能发现注册异常、登录攻击、额度异常和邮件发送失败。

### 收费可开放

- 支付 webhook 验签和幂等通过测试。
- 套餐、配额、扣费、退款和到期规则一致。
- 用户能查看用量、套餐、账单和取消方式。
- 备份恢复与回滚已经实际演练，而不只有文档。

## 13. 最大风险

1. **双身份拼接风险**：直接让 Web JSON 用户与 MCP PostgreSQL 用户通过邮箱松散关联，可能造成串号；必须有明确迁移和唯一约束。
2. **权限回退风险**：数据库、token 或用户上下文异常时不能回退为 local admin。
3. **只验 API、不验文件的风险**：数据库 RLS 不能保护本地文件、SQLite 和已有签名 URL。
4. **迁移破坏旧工作区的风险**：用户 ID 改动可能影响 `data/users/<uid>` 和凭据目录，必须保留映射或原 ID。
5. **先开放注册后补安全的风险**：公开入口一旦出现，垃圾注册和模型费用会立即产生；安全和配额必须先于公开流量。
6. **重复建设风险**：主 Web 不应重新实现一套与 MCP 不兼容的订阅、refresh token 和 quota。
