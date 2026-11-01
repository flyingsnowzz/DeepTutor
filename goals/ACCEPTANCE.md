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

## T2 — PostgreSQL 多账户存储改造

| 验收项 | 标准 | 证据 |
| --- | --- | --- |
| Alembic | 空 Postgres 可 `upgrade head` 建表 | 迁移日志 |
| Owner 隔离 | 个人数据表均有 `owner_user_id` 与索引 | Schema/测试 |
| Job/Artifact | 幂等、对象存储、签名 URL 可用 | 集成测试 |
| 学习仓储 | session/practice/mastery 新平台路径读写 Postgres | 集成测试 |
| 跨账户安全 | A/B 用户互不可见数据 | E2E 测试 |
| ETL | SQLite → Postgres 支持 dry-run/execute/checksum | ETL 报告 |
| SQLite 退役 | 新 SaaS/MCP 路径不生成业务 `.sqlite3` | 文件系统检查 |
| 备份恢复 | Postgres/对象存储可恢复 | 演练记录 |

## T3 — 云端多账户 streamable HTTP 服务

| 验收项 | 标准 | 证据 |
| --- | --- | --- |
| HTTP MCP | `/mcp` 经 HTTPS 可访问，stdio 传输仍保留 | 联调/回归记录 |
| 401 流程 | 无 token 返回登录/授权 URL | 测试 |
| OAuth/登录 | 至少一种注册登录路径可用 | E2E |
| 数据隔离 | practice/mastery/job/artifact 均按 owner 校验 | E2E + 审计 |
| 学习状态 | practice/mastery/review 工具可用，写操作有证据和幂等 | 集成测试 |
| 解题能力 | `problem_solve_*` 通过 Job 分步解题并可给同类题 | E2E |
| 主观题判分 | `quiz_judge_*` 异步判分，输出形成性反馈 | E2E |
| 音频能力 | `audio_overview_generate_*` 生成音频和逐字稿 | artifact |
| 出题能力 | T1 的 `quiz_generate_*` 在 HTTP 下仍可用 | 回归测试 |
| 订阅额度 | 免费/付费额度和超额拦截可用 | 测试 |
| Postgres 恢复 | 备份可在干净环境恢复 | 恢复演练 |
| 对象存储 | 签名 URL 过期且不可越权 | 安全测试 |
| 审计限流 | 工具调用有审计；高频调用被限流 | 日志/压测 |

## T4 — P3 精读、教学媒体与 Hook

| 验收项 | 标准 | 证据 |
| --- | --- | --- |
| 沉浸式精读 | `reading_session_start/reply` 可引用页码、章节或时间戳 | E2E |
| 视频课 | `lesson_video_generate_*` 可提交、轮询、取消并返回 artifact | E2E |
| 数学动画 | `math_animation_generate_*` 依赖就绪时可渲染，缺失依赖时明确不可用 | E2E/依赖测试 |
| Hook | 重复事件不会重复创建复习任务，失败重试可追踪 | 幂等测试 |
| 媒体依赖 | Node/Remotion/Manim/LaTeX/ffmpeg/TTS 的 ready/missing 状态准确 | 依赖测试 |
| 成本提示 | 长任务提交前展示耗时/成本，产物只返回授权 URL | UI/API 记录 |

## T5 — WorkBuddy Skill 包与上架

| 验收项 | 标准 | 证据 |
| --- | --- | --- |
| 技能目录 | `workbuddy-skills/deeptutor-learning/` 包含 SKILL.md、references、templates/examples | 目录清单 |
| Frontmatter | name/display_name/display_name_en/description/description_zh/description_en/version/author 完整 | 静态校验 |
| MCP 配置 | stdio/HTTP 配置均可复制联调，且只含 `${...}` 占位 | 配置样例 |
| 工具选择 | references 中明确用户意图到 MCP 工具的映射 | 文档审查 |
| Job 流程 | 提交、轮询、needs_input、失败、取消、artifact 获取流程完整 | E2E 脚本 |
| 本地联调 | WorkBuddy 能发现 MCP server 并触发主技能 | 截图/日志 |
| 场景测试 | 解题、精读、练习、媒体四条 E2E 至少各一条 | 测试记录 |
| 安全扫描 | 无密钥、无任意 shell、无外传数据指令、无危险路径 | 扫描报告 |
| 上架材料 | zip、图标、简介、示例、隐私政策、用户协议齐全 | 提交清单 |

## 跨阶段硬性要求

- [ ] 所有 MCP 工具不得暴露 `exec`、shell、任意文件读写、provider 密钥配置。
- [ ] 外部宿主不能驱动第二个 DeepTutor agent loop。
- [ ] DeepTutor 自有 App/Web/SDK 不经过 MCP。
- [ ] 新 SaaS/MCP 路径不打开业务 SQLite。
- [ ] 资源 ID 不可被跨账户枚举访问。
- [ ] 长任务必须通过 job/artifact 模型。
- [ ] 产物不返回服务器本地绝对路径。
- [ ] 文档、错误提示和 Skill 文案保持中文用户可理解。

