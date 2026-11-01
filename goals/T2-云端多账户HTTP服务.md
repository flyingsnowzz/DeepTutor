# T2 — 云端多账户 HTTP 服务

## 目标

把 T1 的本地 stdio MCP 升级为可被 WorkBuddy、千问办公、豆包等外部宿主通过网络访问的多账户服务，完成注册登录、账户隔离、Postgres 托管、对象存储、额度计量和安全审计，达到外部试用标准。

## 前置依赖

- T1 本地 stdio 与 Postgres-only 最小闭环通过。

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

### 3. Postgres 产品化

使用托管 Postgres 或等价生产环境：

- PITR；
- 自动备份；
- HA/只读副本按阶段规划；
- 连接池；
- 迁移流程；
- RLS 作为纵深防御；
- 应用层强制 owner 谓词。

扩展核心表：

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

### 5. 学习状态能力

当 practice/mastery Postgres 仓储就绪后开放：

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

要求：

- 每个资源都校验 owner；
- review 使用幂等 request id；
- 掌握度更新有证据和事件。

### 6. 出题能力

开放异步：

- `quiz_generate_submit`
- `quiz_job_get`

不做阻塞式同步生成。要求：

- 题目结构稳定；
- 支持材料引用；
- 可生成题目 artifact 或结构化题单；
- 失败可解释。

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

### 9. 数据迁移与回滚演练

- 旧 SQLite 只作为一次性 ETL 来源；
- 迁移脚本按目录属主映射用户；
- 按账户核对数量和校验和；
- 备份恢复演练；
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

- [ ] `/mcp` 可通过 HTTPS 反向代理访问。
- [ ] 未认证调用返回标准 401 流程。
- [ ] 两个不同账户无法读取彼此 job、artifact、practice、mastery 数据。
- [ ] 幂等重试不重复扣额度、不重复计分。
- [ ] 超额调用被正确拒绝并给出升级提示。
- [ ] Postgres 备份可在干净环境恢复。
- [ ] 对象存储链接短期有效且不能越权访问。
- [ ] 新业务路径无 SQLite 写入。
- [ ] 关键接口具备限流、审计和 request id。
- [ ] 至少完成一次真实外部宿主联调。

## 非目标

- 不做企业 SSO。
- 不做组织/席位/团队报表。
- 不做监考、证书或正式考试认证。
- 不承诺替代学校成绩或官方测评。

