# WorkBuddy × DeepTutor 多目标开发计划

> 来源方案：[`../docs-for-dev/WorkBuddy集成方案.md`](../docs-for-dev/WorkBuddy集成方案.md)  
> 目标模式：每个目标（Target）都必须有明确产出、完成标准、测试证据和非目标。完成一个目标后再进入下一个目标。

## 目标序列

| 目标 | 名称 | 主要结果 | 依赖 |
| --- | --- | --- | --- |
| [T0](./T0-契约冻结与本地Spike.md) | 契约冻结与本地 Spike | MCP 工具契约、作业状态机、账户/数据边界、CLI Spike 证据 | 无 |
| [T1](./T1-本地MCP最小闭环.md) | 本地 stdio MCP + Postgres/MinIO 最小闭环 | `deeptutor mcp serve`、作业原语、研究/可视化 job、Postgres-only 持久化 | T0 |
| [T2](./T2-云端多账户HTTP服务.md) | 云端多账户 HTTP 服务 | streamable HTTP `/mcp`、OAuth、Postgres 托管、对象存储、订阅/额度、审计 | T1 |
| [T3](./T3-教学媒体与WorkBuddy上架.md) | 教学媒体与 WorkBuddy 上架 | 解题/精读/音频/视频/数学动画、Skill 包、安全扫描与上架 | T2 |
| [验收矩阵](./ACCEPTANCE.md) | 全量验收 | 每阶段功能、安全、性能、数据隔离和回滚检查 | 全部目标 |

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
- T3：补齐教学媒体和 WorkBuddy 上架材料。

