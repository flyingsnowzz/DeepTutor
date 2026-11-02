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
在官方 MCP 客户端下均成功 `initialize` 与 `list_tools`（等价于宿主连接指示灯正常；
WorkBuddy 桌面端截图待客户端接入后补拍）。

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
=> PASS（14 个文本文件，0 errors）

python scripts/release/build_workbuddy_skill_zip.py workbuddy-skills/deeptutor-learning dist/workbuddy-skills
=> dist/workbuddy-skills/deeptutor-learning-0.1.0.zip（validated: true，14 个文件）

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
