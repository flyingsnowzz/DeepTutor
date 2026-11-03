# WorkBuddy 本地联调与安全扫描报告（T5，2026-11-02）

## 1. MCP 连接与自检

| 项 | 结果 |
| --- | --- |
| Postgres/MinIO/LocalStack 启动 | `docker compose -f deploy/docker-compose.postgres-minio.yml up -d` 正常 |
| `deeptutor mcp serve --transport stdio` | 可启动，MCP 客户端 `list_tools` 正常 |
| `deeptutor mcp serve --transport http` | 可启动，`/healthz`、`/readyz` 正常 |
| `capabilities_list` | 返回全部能力（含 ready / missing_dependency） |
| 研究/可视化 job | 提交并轮询成功，artifact 可取短期链接 |
| 登录/401 流程 | 未认证 /mcp 返回 401 + 登录/注册 URL（T3 已验证） |

连接指示灯：stdio 与 streamable HTTP 两种 MCP 配置（`workbuddy-skills/mcp-config/`）
在官方 MCP 客户端下均成功 `initialize` 与 `list_tools`；WorkBuddy 桌面端实际接入与
`39/39` 工具启用截图见第 5 节。

## 2. 四条 E2E 场景（stdio + HTTP 各跑一遍）

运行：

```bash
python scripts/workbuddy/e2e/run.py
```

| 场景 | stdio 记录 | HTTP 记录 |
| --- | --- | --- |
| K12 数学（解题+同类题） | `e2e/01-k12-math-stdio.json` | `e2e/01-k12-math-http.json` |
| 大学材料精读→引用→复习题 | `e2e/02-reading-session-stdio.json` | `e2e/02-reading-session-http.json` |
| 练习闭环（错因+SRS 复习+幂等重放） | `e2e/03-practice-loop-stdio.json` | `e2e/03-practice-loop-http.json` |
| 媒体作业（可视化/音频/视频 + 依赖门） | `e2e/04-media-generation-stdio.json` | `e2e/04-media-generation-http.json` |

每条记录含：用户话术、命中技能、完整工具请求/返回、最终回复、耗时与成本（确定性
运行器，LLM 成本 0）。全部通过，未使用真实模型凭据。

## 3. 静态规范与安全扫描

```text
python scripts/release/validate_workbuddy_skill.py workbuddy-skills/deeptutor-learning
=> PASS（15 个文本文件，0 errors）

python scripts/release/build_workbuddy_skill_zip.py workbuddy-skills/deeptutor-learning dist/workbuddy-skills
=> dist/workbuddy-skills/deeptutor-learning-0.1.0.zip（validated: true，25 个文件（含 README））

python -m pytest tests/workbuddy_skills -q
=> 8 passed（frontmatter、结构、敏感信息、工具名一致性、无脚本、zip 构建、负例）
```

- 无硬编码 token/密钥/生产路径；
- 无可执行脚本（审核包仅 Markdown/JSON/PNG）；
- references 工具名与 MCP 实现一致；
- 无提分/官方成绩承诺；判分注明形成性反馈；
- 无未授权教材/真题内容。

## 4. 待提交材料

- zip：`dist/workbuddy-skills/deeptutor-learning-0.1.0.zip`（含 manifest 与 sha256）
- 图标/展示图：`workbuddy-skills/deeptutor-learning/listing/{icon,showcase}.png`
- 隐私政策、用户协议、未成年人保护、服务依赖、授权解绑、支持邮箱（占位待运营替换）
- 内部审核队列：待 WorkBuddy 开放平台账号与客户端接入后提交；提交前需把占位邮箱与域名替换为正式值。

## 5. 2026-11-03 补充：模型分工、真实模型与桌面端接入

### 模型调用分工

- **WorkBuddy 宿主模型**：意图理解、对话组织、简单讲解、普通题目与媒体初稿等简单内容生成。
- **DeepTutor**：复杂多阶段 Agent 管线（研究、复杂出题/解题、精读）、资料处理、判题、练习/掌握度/SRS 状态和教学产物。
- 宿主已经生成的内容不再交给 DeepTutor 重复生成。普通题目通过 `practice_entry_create` 入库，再调用 `practice_answer_check` / `practice_review_submit` 完成学习闭环。
- 需要 DeepTutor 复杂能力时，直接消费其结果，不让宿主再生成一份替代答案。

场景 06 验证了上述边界（运行 `python -m scripts.workbuddy.e2e.host_driven_practice`）：

| 场景 | 证据 | 结果 |
| --- | --- | --- |
| 宿主出题 → DeepTutor 判题与复习 | `e2e/06-host-driven-practice-stdio.json` | 宿主提供完整选择题；DeepTutor 仅做入库、错答识别、SRS 和统计，无服务端生成调用 |

> 场景 06 是 MCP 协议级确定性验证，题目由测试脚本模拟宿主提供；它不是 WorkBuddy 桌面端真实模型调用的截图证据，也不代表 DeepTutor 真实生成能力。后者由场景 05 单独验证。

### WorkBuddy 客户端实际接入

- 在 `~/.workbuddy/mcp.json` 注册 `deeptutor` stdio 服务，重启客户端后，“MCP 服务管理”
  显示 `deeptutor` 已连接，`39/39 个工具已启用`。连接指示灯截图：
  [`mcp-connection.png`](./mcp-connection.png)。
- 初次连接时完成一次“信任此 MCP 服务”确认。首次排障发现：
  1. `DEEPTUTOR_HOME` 未指向项目根目录时，日志目录会落到只读根目录并启动失败；
  2. `DEEPTUTOR_MCP_DETERMINISTIC=1` 只返回占位内容，不调用真实模型。
  现已分别修正为项目根目录和 `DEEPTUTOR_MCP_DETERMINISTIC=0`。

### Skill 安装、显式触发与真实桌面端对话

| 验收项 | 证据 | 结果 |
| --- | --- | --- |
| 本地 Skill 安装与启用 | `skill-installed.png` | `~/.workbuddy/skills/deeptutor-learning` 出现在“已安装”，开关为启用 |
| `/deeptutor-learning` 显式触发 | `skill-trigger-e2e.png` | Skill 标签被客户端正确识别；能力检查、复习队列、练习统计与记录查询成功 |
| 完整“今日复习”对话 | `workbuddy-review-e2e-full.png`、`e2e/07-workbuddy-desktop-review.json` | `practice_summary_get` + `review_tasks_list` 返回真实统计，31 秒完成 |
| WorkBuddy 宿主生成 5 题并写库 | `host-generated-practice-tools.png`、`host-generated-practice-e2e.png`、`e2e/08-workbuddy-skill-host-generated-practice.json` | 客户端明确显示“由我生成”，随后调用 `practice_entry_create`；PostgreSQL 查到对应 5 条 `skill_managed` 记录 |

- 第 8 条场景只验证“现成题目入库”能力，不是 DeepTutor 默认出题路径。后续路由已修正：
  用户显式使用 DeepTutor Skill 时，默认通过 `quiz_generate_submit` 实际出题，宿主不得代做。
- 仅输入自然语言“今天复习什么？”时，WorkBuddy 可能先询问学习方向；因此上架示例和
  README 使用明确的 `/deeptutor-learning ...` 触发方式，不把自然语言路由稳定性夸大成确定行为。

### 真实内容生产验证（不是 WorkBuddy 兜底生成）

| 场景 | 证据 | 结果 |
| --- | --- | --- |
| stdio 真实出题 | `e2e/05-real-llm-quiz-stdio.json` | job succeeded，完整题干 + A–D 选项 + 正确答案 + 解析 |
| streamable HTTP 真实出题 | `e2e/05-real-llm-quiz-http.json` | Bearer 多账户路径 job succeeded，完整题干 + A–D 选项 + 正确答案 + 解析 |

- 两次验证均调用 `quiz_generate_submit` → `quiz_generate_job_get`，使用
  `DEEPTUTOR_MCP_DETERMINISTIC=0` 和真实 `spark-x2.6` 模型；
- 返回 `summary.success=true / completed=1 / failed=0`，不是占位结果；
- stdio 记录约 113 秒、4 次模型调用、17,566 tokens；HTTP 记录同题独立成功；
- 说明：前两次真实尝试曾出现模型规划/输出不完整，第三次完整链路成功。生产使用仍需
  关注模型输出稳定性与失败重试，不能把“管线接通”等同于“每次生成必然合格”。

### 独立干净环境安装复核

场景 09（`e2e/09-clean-environment-stdio.json`）使用全新 venv 和全新技能目录完成：

1. 按 `requirements/core.txt` + `requirements/mcp.txt` 安装依赖，再以 `--no-deps` 安装当前源码；
2. 将技能复制到独立 `workbuddy-home/skills/deeptutor-learning`，validator 通过；
3. `pip check` 无损坏依赖；stdio `initialize`、`list_tools` 成功，共 39 个工具；
4. `practice_summary_get` 成功返回当前账户 12 条练习。

首次复核发现 `SQLAlchemy` 异步引擎缺少 `greenlet`，已将 `requirements/mcp.txt`
修正为 `SQLAlchemy[asyncio]>=2.0.0` 后重新安装并验证通过。该记录证明 README 所述
安装与联调路径可在无既有 Python 包的干净环境中复现；WorkBuddy 桌面端安装则由上述
真实客户端截图单独证明。

## 6. 后续真实能力审计与客户端复验

完整审计见 [`capability-audit/README.md`](./capability-audit/README.md)。真实模式已验证：
解题、出题、判分、精读、可视化和掌握路径均有本领域实际产出；研究、音频、视频和
数学动画仍有模型稳定性或外部依赖阻塞，不再用协议成功代替能力验收。

WorkBuddy 重启后已确认实际进程为 `DEEPTUTOR_MCP_DETERMINISTIC=0`。简化后的真实
visualize 请求由 DeepTutor 返回正确 Mermaid，并在客户端展示，证据：
[`capability-audit/workbuddy-visualize-real.png`](./capability-audit/workbuddy-visualize-real.png)。
较复杂请求曾发生模型停滞，因此同时增加服务端能力超时和结果有效性校验。
音频已增加离线 macOS `say` TTS，并完成真实 MP3 与逐字稿的产物下载验证；其他部署环境仍需配置可用 TTS。
真实 `quiz_generate_submit` 也已在 WorkBuddy 中返回完整选择题和解析，证据：
[`capability-audit/workbuddy-quiz-real.png`](./capability-audit/workbuddy-quiz-real.png)。

## 7. 当前仍需外部条件完成的事项

- **WorkBuddy 开放平台提交**：需平台账号与客户端审核入口，内部 zip 已就绪。
- **运营占位信息替换**：`listing/support-contact.md` 中的支持/安全邮箱和示例域名需换成
  正式值后才能提交审核。
