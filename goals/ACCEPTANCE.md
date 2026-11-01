# 验收矩阵

## T0 — 契约冻结与 Spike

| 验收项 | 标准 | 证据 |
| --- | --- | --- |
| CLI Spike | 至少研究、可视化、出题三类能力有成功/失败记录 | 命令、输出、耗时、错误样例 |
| 工具契约 | 所有 T1/T2 工具具备 JSON Schema | 契约文档 |
| 作业状态机 | queued/running/needs_input/succeeded/failed/canceled 语义明确 | 状态机文档和测试 |
| 幂等 | `(owner_user_id,idempotency_key)` 唯一 | Schema/测试 |
| Skill 草稿 | frontmatter 满足 WorkBuddy 必填字段 | 静态检查 |

## T1 — 本地 MCP 最小闭环

| 验收项 | 标准 | 证据 |
| --- | --- | --- |
| stdio 启动 | `deeptutor mcp serve --transport stdio` 可被 MCP 客户端发现工具 | MCP Inspector 记录 |
| Postgres-only | 运行测试后无新增业务 `.sqlite3` | 文件系统检查 |
| Job 提交 | 研究/可视化可提交并返回 job id | 集成测试 |
| Job 轮询 | 可查询状态和结果 | 集成测试 |
| 取消 | running/queued job 可取消或进入明确终态 | 集成测试 |
| Artifact | 产物写 MinIO/S3，接口返回受控链接 | 集成测试 |
| 账户隔离 | A/B 账户互不可见 job/artifact | 集成测试 |
| stdout 纯净 | stdout 只有 MCP 协议 | 协议抓包 |

## T2 — 云端多账户服务

| 验收项 | 标准 | 证据 |
| --- | --- | --- |
| HTTP MCP | `/mcp` 经 HTTPS 可访问 | 联调记录 |
| 401 流程 | 无 token 返回登录/授权 URL | 测试 |
| OAuth/登录 | 至少一种注册登录路径可用 | E2E |
| 数据隔离 | practice/mastery/job/artifact 均按 owner 校验 | E2E + 审计 |
| 订阅额度 | 免费/付费额度和超额拦截可用 | 测试 |
| Postgres 恢复 | 备份可在干净环境恢复 | 恢复演练 |
| 对象存储 | 签名 URL 过期且不可越权 | 安全测试 |
| 审计 | 工具调用有 request/user/job/resource/status 记录 | 日志样例 |
| 限流 | 高频调用被限制且错误可理解 | 压测/测试 |

## T3 — 教学媒体与上架

| 验收项 | 标准 | 证据 |
| --- | --- | --- |
| 解题 | 可分步解题并给同类练习 | E2E |
| 精读 | 引用页码/章节/时间戳 | E2E |
| 出题批改 | 客观题即时反馈，主观题异步判分 | E2E |
| 掌握度 | 作答后掌握度和复习任务变化 | 数据快照 |
| 音频 | 可生成音频和逐字稿 | artifact |
| 视频/动画 | 依赖就绪时可渲染；缺失时明确不可用 | E2E/依赖测试 |
| Skill 上架 | 通过必填字段、安全扫描和权限检查 | 审核截图/报告 |
| 合规文案 | 不承诺提分、官方成绩或证书 | 文案审查 |

## 跨阶段硬性要求

- [ ] 所有 MCP 工具不得暴露 `exec`、shell、任意文件读写、provider 密钥配置。
- [ ] 外部宿主不能驱动第二个 DeepTutor agent loop。
- [ ] DeepTutor 自有 App/Web/SDK 不经过 MCP。
- [ ] 新 SaaS/MCP 路径不打开业务 SQLite。
- [ ] 资源 ID 不可被跨账户枚举访问。
- [ ] 长任务必须通过 job/artifact 模型。
- [ ] 产物不返回服务器本地绝对路径。
- [ ] 文档、错误提示和 Skill 文案保持中文用户可理解。

