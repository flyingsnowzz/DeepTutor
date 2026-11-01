# Codex 目标模式：WorkBuddy × DeepTutor 开发目标

> 来源方案：[`../docs-for-dev/WorkBuddy集成方案.md`](../docs-for-dev/WorkBuddy集成方案.md)  
> 本目录专门为 **Codex 目标模式（goal mode）** 准备。每个 `T*.md` 都是一个可分配给 Codex 独立执行的工程目标：包含目标、成功条件、实现任务、验收命令/证据、约束和非目标。除非目标明确要求，否则不要跨目标提前实现。

## Codex 执行约定

- 每个目标必须在当前代码库中产生可审查的代码或文档产出，不能只写计划。
- 每个目标结束时必须能给出：变更文件、测试命令、测试结果、风险和未完成项。
- 未满足“完成标准”的目标不得标记完成。
- 若发现目标与现有代码冲突，应先更新对应目标文件，再实现代码。
- 所有目标默认遵守 [DIRECTORY_LAYOUT.md](./DIRECTORY_LAYOUT.md) 的目录规划。

### MCP 传输模式策略

| 阶段 | 必须支持 | 用途 |
| --- | --- | --- |
| T1 | stdio | 本地开发、MCP Inspector、WorkBuddy 桌面端本地配置 |
| T2 | streamable HTTP（主） + stdio（保留） | 云端多账户、远程访问、OAuth/订阅额度、外部宿主集成 |
| T2 可选 | SSE | 兼容只支持 SSE 的旧宿主；仅在 WorkBuddy/其他宿主明确需要时实现 |

结论：**MCP 不只做 stdio。** T1 先做 stdio 是为了本地闭环；T2 必须实现远程 HTTP/SSE 能力，其中 streamable HTTP 是主路径。

## 目标序列

| 目标 | 名称 | 主要结果 | 依赖 |
| --- | --- | --- | --- |
| [T0](./T0-契约冻结与本地Spike.md) | 契约冻结与本地 Spike | MCP 工具契约、作业状态机、账户/数据边界、CLI Spike 证据 | 无 |
| [T1](./T1-本地MCP最小闭环.md) | 本地 stdio MCP 最小闭环 | `deeptutor mcp serve --transport stdio`、作业原语、研究/可视化 job、本地 Postgres/MinIO 开发闭环 | T0 |
| [T2](./T2-PostgreSQL多账户存储改造.md) | PostgreSQL 多账户存储改造 | Postgres-only 系统库、owner 隔离、session/practice/mastery 仓储、ETL、对象存储、usage | T1 |
| [T3](./T3-云端多账户HTTP服务.md) | 云端多账户 streamable HTTP 服务 | 远程 `/mcp`、OAuth、订阅额度、限流审计、解题/判分/音频/掌握度写操作 | T2 |
| [T4](./T4-教学媒体能力.md) | P3 精读、教学媒体与 Hook | 沉浸式精读、视频课、数学动画、复习 Hook 和媒体工坊能力 | T3 |
| [T5](./T5-WorkBuddy技能包开发与上架.md) | WorkBuddy Skill 包 | 技能目录、frontmatter、references、MCP 调用、本地测试、上架材料 | T1/T3/T4 |
| [验收矩阵](./ACCEPTANCE.md) | 全量验收 | 每阶段功能、安全、数据隔离和回滚检查 | 全部目标 |

## 总体原则


1. **DeepTutor 自有 App/Web/SDK 不走 MCP**：MCP 仅服务 WorkBuddy、千问办公、豆包等外部宿主。
2. **MCP 是适配层，不是第二套教学内核**：所有工具最终调用统一的 `TurnApplicationService`、Capability、LearningService、Job/Artifact 服务。
3. **Postgres-only**：新 MCP/SaaS 运行路径不创建或打开业务 SQLite；本地开发和 CI 都使用 Postgres 容器。
4. **多账户而非组织租户**：首版以 `owner_user_id` 做个人数据隔离，不预建组织、席位、SSO 和团队报表。
5. **长任务一律 job 化**：研究、出题、音频、视频、动画不做阻塞式 MCP 同步调用。
6. **不暴露第二个 agent loop**：外部宿主保留唯一 agent loop，DeepTutor 只暴露结构化工具和作业。
7. **不暴露危险能力**：不注册裸 `chat`、`exec`、任意文件路径、provider 配置或通用系统管理工具。

## 建议执行节奏

- T0：先冻结契约和风险，不写生产 MCP 代码。
- T1：完成开发机可运行闭环，允许只开放研究/可视化和基础作业原语。
- T2：达到可给外部试用用户使用的云端标准。
- T3：补齐解题、精读、音频、视频、动画等教学媒体后端能力。
- T4：独立开发、测试并提交 WorkBuddy Skill 包。

