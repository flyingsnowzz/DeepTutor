# DeepTutor × DeepSeek Harness 集成调研与方案

> 目标：把 DeepTutor 的资产用进 DeepSeek Harness（DSH），而不是把 DeepTutor 整个搬进 DSH。
> 本文分四部分：DSH 事实调研 → DeepTutor 可搬资产盘点 → 价值判断 → 可执行方案。

---

## 0. 结论（TL;DR）

**最有价值的不是 DeepTutor 的 harness 内核，而是它的「领域能力层 + 知识/RAG 层」。**

DSH 已经自带 Harness 的全部核心：agent loop、工具系统与门禁、会话持久化与回放、沙箱、定时任务、子代理、MCP 桥、技能系统、UI。DeepTutor 与之重叠的部分（编排器、Turn 服务、事件总线、Web 前端、会话库）搬过去只会造成**双 agent loop / 双会话语义**，是负资产。

DSH 生态缺、而 DeepTutor 已经做完的是：

| 排序 | 资产                                                                                                                              | 为什么在 DSH 里有价值                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **知识库 / RAG + 多格式文档解析**（PDF/DOCX/PPTX/XLSX → 索引 → 检索 → 引用）                                                      | DSH 出厂工具是 `bash/read/grep/edit` 级别的文件操作，没有"把一本书变成可检索知识库"的链路；它的官方记忆插件（Engram/Memorix 等）是 opt-in 外部 MCP 示例，不是面向文档语料的 RAG |
| 2    | **多阶段 Capability 流水线**（`deep_research` / `deep_solve` / `deep_question` / `visualize` / `math_animator` / `video_lesson`） | DSH 的 skill 是"Markdown 指令层"，长流程编排仍靠模型即兴发挥；DeepTutor 把这些流程固化成了代码级 stage pipeline，是可直接复用的"成品工作流"                                     |
| 3    | **学习/掌握度与评测**（`deeptutor/learning/`：mastery、grading、policy）                                                          | DSH 无对应概念                                                                                                                                                                  |
| 4    | **用量账本 + 定价 + trace**（usage.sqlite3、cost_summary）                                                                        | DSH 有 traces（开发者面板），但账单口径的 ledger 是 DeepTutor 的独立资产                                                                                                        |

**推荐接入形态**：把 DeepTutor 降级为 **"工具/技能提供方"**，DSH 保持唯一主循环。

> 关于"能不能直接做成 DSH 插件"：MCP 桥**本身就是 DSH 插件**（官方 `@deepseek-ai/dsh-mcp-client`）；自研原生插件的边界与取舍见 **§4.3**，可行但那几个 MCP 够不到的"缝"才值得写 TS。

> 动手写 MCP 桥之前请先读 **§5.0 实现要点**——那里记录了三个会让桥直接跑不起来的坑（stdout 被 CLI 打印污染、`maybe_run` 关闭常驻容器、答案不在 `content` 事件里）。

```
DSH（宿主，唯一 agent loop）
 ├─ plugin  @deepseek-ai/dsh-mcp-client ──stdio / streamable-http──▶ deeptutor-mcp（FastMCP）
 │                                                                   tools: mcp__deeptutor__*
 │                                                                     · deeptutor_run(capability, message, kb)
 │                                                                     · kb_search / kb_ingest / kb_list
 │                                                                     · memory_* / notebook_*
 ├─ skill   deeptutor-cli（SKILL.md 直投，零代码，让模型知道 CLI 怎么用）
 ├─ plugin  dsh-plugin-deeptutor（可选，§4.3）──ctx.subprocess──▶ 同一个 Python sidecar
 │                                                                   MCP 退居内部 RPC
 │                                                                   + ctx.jobs（长任务）
 │                                                                   + ctx.skills provider（动态目录）
 │                                                                   + 工具 UI 卡片
 └─ subagent DeepTutor（仅长流程：deep_research 等多阶段任务显式委派，内部自带 loop）
```

---

## 1. 调研：DeepSeek Harness 是什么

先把它"是什么、能扩展什么、做桥接必须知道哪些运行时语义"分三层说清。本节所有 DSH 事实均来自官方文档原文核对（见 §10）。

### 1.1 定位与架构

DSH 是 DeepSeek 官方开源的 **agent harness**（不是模型），基于 [Cordis](https://github.com/cordiverse/cordis) 的「**everything is a plugin**」内核：models、tools、skills、sessions、sandboxes、storage、agent loop、scheduling、UI **全部是插件**，可通过配置替换或扩展，无需改 DSH 源码。

- 启动：`npx @deepseek-ai/dsh web`（Web UI，默认 `http://127.0.0.1:3080`）
- 源码：<https://github.com/deepseek-ai/deepseek-harness>
- 插件生态：GitHub topic `dsh-plugin`（社区站统计已核验上万插件）

### 1.2 四条扩展缝（关键）

| 缝隙         | 机制                                                                                                                                                                                                                                                                                                                   | 你能得到什么                                                                    | 关键限制                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plugin**   | TS 模块导出 `apply(ctx)`；`export const inject = ['tools']` 声明依赖；`ctx.tools.register(defineTool(...))`；`ctx.effect(fn)` 注册清理                                                                                                                                                                                 | 进程内一等公民工具/服务/UI 插槽                                                 | 需 TypeScript + npm 包；改的是 DSH 进程                                                                                                                               |
| **Skill**    | `<root>/<name>/SKILL.md`（frontmatter `name`/`description` 必填，kebab-case）或扁平 `<name>.md`；根按 rank 扫描：`<projectRoot>/.dsh/skills`(100) → `.agents/skills`(200) → `customSkillDirs`(300) → `<dshHome>/skills`(400) → `~/.agents/skills`(500)；也可由插件 `ctx.skills.register()` / `registerProvider()` 提供 | 渐进披露的指令层，模型按需 `list()` → `get(name)` 展开全文                      | 只是 Markdown 指令，不能自带强类型工具                                                                                                                                |
| **MCP**      | 官方插件 `@deepseek-ai/dsh-mcp-client`，一个插件实例 = 一个 MCP 服务器；`transport: stdio` 或 `streamable-http`；工具并入 `ctx.tools`，公开名为 `mcp__<serverName>__<rawName>`                                                                                                                                         | **一行配置**把外部工具纳入 DSH 工具治理（`tools/pre-execute` 门禁、超时、取消） | 只桥接 tools，**Resources/Prompts 无消费方**；`toolCallTimeoutMs` 默认 60000；**激活期 `listTools()` 另有 60s 上限（继承 MCP SDK）**，与 `toolCallTimeoutMs` 是两码事 |
| **Subagent** | DSH 自带 subagents 插件，把子任务委派给别的 agent                                                                                                                                                                                                                                                                      | 长流程委派，宿主 loop 不阻塞                                                    | 双 loop / 双会话语义需明确切分                                                                                                                                        |

### 1.3 运行时语义（做桥接必须知道）

- **事件双轨**：`agent/*` 负责实时队列与状态，`session/event` 负责**持久回放**。
- **turn 生命周期**：`pre-step` → `request` → 工具执行 → `step/end` → `turn/end`。
- **模型 request 里的工具调用事件**：`assistant/chunk`（`text-delta` / `reasoning-delta`）、`tool/call`、`tool/result`、`turn/end`（`reason.data.reason.kind == "error"` 表示失败）。

  > 这套 schema DeepTutor 已经实现过一遍了 —— 见 [deepseek_harness.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/subagent/deepseek_harness.py#L258-L324)，它把上述事件映射成 DeepTutor 的 `EVENT_TEXT / EVENT_REASONING / EVENT_TOOL / EVENT_TOOL_RESULT / EVENT_ERROR`。做正向桥时可以反向复用这套知识。

- **Python SDK**：`pip install deepseek-harness-sdk`，`from deepseek_harness import DeepSeekHarness`，以 `cordis.yml` 组合定义 agent 能力面，`session_root` 落 JSONL 会话日志；`DeepSeekHarness` 懒启动内置 runtime 并在上下文管理器内复用。

  > DeepTutor 同样已经用了它 —— [deepseek_harness.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/subagent/deepseek_harness.py#L167-L243)，包含 `dsh_home`、`reasoning_effort`、`on_notification` 回调等细节。**结论：双向桥的"反向"方向已经存在且有生产级实现，正向方向（DSH 调 DeepTutor）目前空缺。**

### 1.4 L1/L2 的文档与 SDK 差异（易踩坑）

- 一个插件实例只对应一个 MCP server；同名 `serverName` 的后装实例会失败。
- 工具名会规范化到 DeepSeek 函数名契约（≤64 字符、`[A-Za-z0-9_-]`），超长时追加 12 位哈希。
- MCP 启动超时继承 MCP SDK 默认 **60 秒**；不响应的 server 会拖慢激活与清理。

### 1.5 能力缝（capability seams）——原生插件能挂哪些点

DSH 把"可替换的能力"拆成 **Service Definition / Provider / Consumer** 三角色（[官方 capability-seams 全量图谱](https://deepseek-harness.github.io/deepseek-harness/en/reference/capability-seams)）。对 DeepTutor 有意义的缝：

| 缝                                  | 语义                                                                                     | 内置实现                                                      | 对 DeepTutor 的意义                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `ctx.skills`                        | Skill provider 注册表                                                                    | `skill-filesystem` / `skill-badge`                            | 用 `registerProvider()` **动态生成**能力/KB 目录为 skill，取代手工拷 SKILL.md |
| `ctx.jobs`                          | 后台任务注册表                                                                           | `jobs-local` / `tool-jobs`                                    | `kb_ingest` 直接复用官方 job 运行时（jobId、cancel、readOutput、owner 清理）  |
| `ctx.tools`                         | 工具注册表 + 受控执行管线（pre-policy / guard / around-dispatch / post-policy / result） | `tool-fs` / `tool-bash` / `tool-web` …                        | 门禁、超时、取消、Code Mode 全部免费                                          |
| `ctx.web`                           | Web 访问 provider 注册表                                                                 | `web-search-exa` / `web-search-perplexity` / `web-fetch-http` | `paper_search` / `zotero_search` 可做成一等 web provider                      |
| `ctx.commands`                      | 人类命令注册表                                                                           | —                                                             | `/kb`、`/cap` 等人类 slash 命令                                               |
| `ctx.clientModules`                 | 客户端插件图宿主（UI）                                                                   | —                                                             | 自定义结果卡片                                                                |
| `ctx.storage` / `ctx.storageDomain` | 非会话存储 / 领域数据设施                                                                | `storage-json` / `storage-sqlite`                             | KB 索引、掌握度状态的耐久化                                                   |
| `ctx.subprocess`                    | 子进程缝                                                                                 | `subprocess-local` / `subprocess-e2b`                         | **跨语言解法的官方出口**（见 §4.3）                                           |

工具侧还有两处只有原生插件才拿得到（MCP 工具拿不到）：

- **UI 卡片**：`presentCall` / `presentResult` 返回 `card` 渲染意图（`generic` / `terminal` / `diff` / `search` / `web`），配 `output.presentationMeta` 把卡片数据持久化在 `tool/result` 上，**session 回放也能重现**。MCP 工具只能落到 generic 卡片，富结果仅限图片。
- **异步通知**：`exec.agent.inject({ content, source })` 把耐久上下文追加进模型的**下一次**请求。

---

## 2. 调研：DeepTutor 有哪些可搬资产

对照 §1 得到的 DSH 能力面，逐项盘点 DeepTutor 的资产：哪些是 DSH 的真实缺口、哪些已经重叠、搬运成本各是多少。结论先看 §2.1 的表，§2.2 是其中几项"顺手就能拿"的红利。

### 2.1 资产 × 可搬性 × DSH 是否已有

| 资产                                                                                                                 | 代码位置                                                                                                                                                                                         | DSH 是否已有                                            | 可搬性                                                         | 建议                                   |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------- |
| Capability 流水线（deep_research 等 10 个）                                                                          | [deeptutor/capabilities/](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/capabilities)                                                                                                    | 无（只有 prompt 级 skill）                              | 高（`deeptutor run <cap> --format json` 已是稳定入口）         | **搬**                                 |
| 知识库 / RAG / 文档解析                                                                                              | [deeptutor/services/rag/](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/rag)、`deeptutor/knowledge/`、`requirements/modules/parsing.txt`                                        | 无（记忆插件是 opt-in 外部示例）                        | 高                                                             | **优先搬**                             |
| 学习/掌握度/评测                                                                                                     | [deeptutor/learning/](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/learning)                                                                                                            | 无                                                      | 中（强领域耦合）                                               | 二期                                   |
| 工具集（`paper_search` / `zotero_search` / `brainstorm` / `reason` / `geogebra_analysis` / `imagegen` / `videogen`） | [deeptutor/tools/builtin/](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/tools/builtin)                                                                                                  | 部分（bash/read/grep 等通用工具）                       | 高（`ToolDefinition` 已是 JSON Schema，几乎可直译成 MCP tool） | **搬**                                 |
| 用量账本 + 定价                                                                                                      | `data/user/usage.sqlite3`、`deeptutor/logging/stats/`                                                                                                                                            | trace 有，账单口径无                                    | 高                                                             | 三期（回报给 DSH）                     |
| Provider / model catalog                                                                                             | [deeptutor/services/llm/provider_registry.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/llm/provider_registry.py)                                                           | **有**（Settings → Models，支持自定义 OpenAI 兼容端点） | 低                                                             | **不搬**                               |
| 编排内核（`ChatOrchestrator` / `TurnEngine` / `TurnApplicationService`）                                             | [orchestrator.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/runtime/orchestrator.py)、[turn_engine.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/runtime/turn_engine.py) | **有**（agent loop 本身就是插件）                       | 低                                                             | **不搬**（双 loop 风险）               |
| StreamBus / 会话持久化 / 重放                                                                                        | [stream_bus.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/runtime/stream_bus.py)、`deeptutor/services/session/`                                                                      | **有**（`session/event` 持久回放）                      | 低                                                             | **不搬**                               |
| Web 前端（Next.js）                                                                                                  | [web/](file:///Users/zhanglei/MyProjects/DeepTutor/web)                                                                                                                                          | **有**（且是 DSH 的强项：UI 插槽 `ctx.slots`）          | 低                                                             | **不搬**                               |
| MCP **客户端**                                                                                                       | [deeptutor/services/mcp/](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/mcp)（`manager.py` 用 `mcp.client.streamable_http`）                                                    | **有**                                                  | —                                                              | 保留，是 DeepTutor 自己消费 MCP 的能力 |

### 2.2 四个"零成本/低成本"发现

1. **DeepTutor 根目录的 [SKILL.md](file:///Users/zhanglei/MyProjects/DeepTutor/SKILL.md#L1-L4) 已经是 DSH 兼容格式**：frontmatter 为 `name: deeptutor-cli` + `description`，正是 DSH `skill-filesystem` 要求的字段（`name` kebab-case、`description` 必填）。把它复制到 `.dsh/skills/deeptutor-cli/SKILL.md` 即可被 DSH 扫描到，**零代码**。
2. **MCP server 侧依赖已就绪**：[requirements/core.txt](file:///Users/zhanglei/MyProjects/DeepTutor/requirements/core.txt#L21) 里 `mcp>=1.26.0,<2.0.0` 是核心依赖，`mcp.server.fastmcp.FastMCP` 可直接用，**不需要新增依赖**。
3. **CLI 已提供机器可读出口**：[main.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor_cli/main.py#L77-L121) 的 `deeptutor run <capability> <message> --format json`，含 `--session` / `--kb` / `--tool` / `--config-json` / `--workspace`，是理想的桥接底座。
4. **HTTP 面也基本齐了**：[deeptutor/api/routers/](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/api/routers) 已有 `knowledge.py` / `memory.py` / `capabilities.py` / `question.py` / `skills.py` / `subagents.py`，`streamable-http` 方案可以复用而不用新写 REST。

---

## 3. 判断：哪一部分最有价值

用统一判据给 §2 的资产排序，并论证为什么"最像 harness 内核的那部分"恰恰**不该搬**——这是整个方案里最容易做错的一步。

### 3.1 判据

> 价值 =（DSH 缺口大小）×（DeepTutor 成熟度）×（迁移成本可控性）

三个因子缺一不可：缺口小则搬了也无增量（如 Provider）；成熟度低则等于把未完成品带进新宿主（如掌握度）；成本失控则长期维护反而拖累（如搬内核）。

### 3.2 排序结论

| 名次  | 资产                         | 缺口 | 成熟度                          | 迁移成本                     | 结论                           |
| ----- | ---------------------------- | ---- | ------------------------------- | ---------------------------- | ------------------------------ |
| **1** | 知识库 / RAG + 文档解析      | 大   | 高（解析→索引→检索→引用全链路） | 中（MCP 桥即可）             | **最值得做，先做**             |
| **2** | Capability 流水线            | 大   | 高（10 条 stage pipeline）      | 中（CLI/SDK 已有 JSON 出口） | 第二优先，做成同族工具 + skill |
| 3     | 学习/掌握度/评测             | 大   | 中                              | 中高（领域数据模型）         | 三期                           |
| 4     | 用量账本                     | 小   | 高                              | 低                           | 三期，作为"可观测回报"         |
| —     | Provider / harness 内核 / UI | 无   | —                               | —                            | **不做**                       |

### 3.3 为什么"harness 内核"不值得搬（反例论证）

- **语义冲突**：DSH 的 turn（`pre-step → request → tool → step/end → turn/end`）与 DeepTutor 的 turn（`capability.run()` + `StreamBus` 事件 + `emit_capability_result()`）是**两套等价语义**。同时存在会出现：两层预算、两层取消、两层重试、两次账单。
- **DSH 的 loop 是插件**：意味着它不是"要替换的组件"，而是"可组合的宿主"。正确姿势是**寄生**，而不是**替换**。
- **维护成本**：搬内核等于承诺跟随 DSH 的 12k+ commit 演进；搬"能力层"则只依赖稳定出口（CLI `--format json` / REST / MCP 协议）。

---

## 4. 方案总览

先给整体架构与四条可选路径的横向对比，再单独展开新增的**路径 D（原生 DSH 插件）**。

### 4.1 架构

```
┌──────────────────────── DeepSeek Harness（宿主，唯一 agent loop） ────────────────────────┐
│  cordis.yml / patch                                                                       │
│                                                                                           │
│  ① skill provider (dsh-skill-filesystem)       ② mcp-client                              │
│     .dsh/skills/deeptutor-cli/SKILL.md            @deepseek-ai/dsh-mcp-client            │
│     → 模型知道 deeptutor CLI 怎么用                config: serverName=deeptutor            │
│                                                  transport=stdio|streamable-http         │
│  ③ subagent（长流程）                                      │                              │
│     delegate deep_research 多阶段任务                       │                              │
└───────────────────────────────────────────────┬───────────────────────────────────────────┘
                                                │ tools/call
                                                ▼
                              ┌──────────────────────────────────────┐
                              │ deeptutor-mcp（新增，FastMCP）        │
                              │  工具：deeptutor_run / kb_* / memory_* │
                              └───────────────┬──────────────────────┘
                                              │ 进程内复用
                                              ▼
                              ┌──────────────────────────────────────┐
                              │ DeepTutor 现有能力层                  │
                              │  capabilities/ · services/rag · tools │
                              └──────────────────────────────────────┘
```

### 4.2 四条路径对比（按推荐度）

| 路径                   | 形态                                                                | 改动量                        | 优点                                                                                | 缺点                                                                              | 适用                                              |
| ---------------------- | ------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| **A. Skill 直投**      | 复制 `SKILL.md` 到 `.dsh/skills/`                                   | **0 代码**                    | 立刻可用；无进程、无依赖                                                            | 模型需自己拼 CLI；无结构化返回；无门禁                                            | 打底、演练、教学                                  |
| **B. MCP 桥（主线）**  | 新增 `deeptutor mcp serve`（FastMCP）+ DSH `mcp-client` 配置        | 中（1 个新模块 + 1 段 patch） | 官方支持路径；自动获得超时/取消/门禁；工具名命名空间干净                            | 只桥接 tools（Resources/Prompts 无效）；长任务需异步化；stdin/stdout 协议调试略烦 | **知识库、单轮能力、记忆/笔记本**                 |
| **C. Subagent 长流程** | DSH 侧把多阶段任务委派给 DeepTutor                                  | 中高                          | 长流程不撑爆宿主上下文；可复用 capability 全部 stage                                | 双 loop/双会话语义需治理；进度与成本需回报                                        | `deep_research`、`deep_question`、`math_animator` |
| **D. 原生 DSH 插件**   | 自研 TS 插件，内部用 `ctx.subprocess` 拉起 DeepTutor Python sidecar | 高（多维护一个 TS/npm 包）    | 拿到 MCP 够不到的缝：UI 卡片、`ctx.jobs`、skills provider、web provider、slash 命令 | 耦合 DSH 的 TS runtime API（演进快）；跨语言进程管理要自己兜                      | 见 §4.3                                           |

**推荐组合：A（打底）+ B（主力）+ D（只在 MCP 够不到处用）+ C（仅长流程）**，并且严格守住"**单 loop 原则**"：

- 走 B 时，DeepTutor 以**无 loop 的工具**身份存在（单轮 `deeptutor run`，一次调用一次返回）。
- 只有走 C 时，DeepTutor 才跑自己的 loop，且必须由 DSH **显式委派**、一轮一次、结果与用量显式回报。
- 走 D 时，插件本身**不跑 loop**，它只是把 DeepTutor sidecar 的出口"重新包装"成 DSH 的原生缝。

### 4.3 路径 D：原生 DSH 插件（TS + `ctx.subprocess`）

**先破除一个误解：走 MCP 不等于"不是插件"。** `@deepseek-ai/dsh-mcp-client` **本身就是 DSH 插件**（注册进 `cordis.yml`）。所以 A/B/C 全都在插件体系内，区别只是**用通用桥接插件，还是自研专用插件**。

那"把 DeepTutor 变成原生插件"到底可不可行？——**可行，但有一条硬边界**：

- DSH 插件 = **进程内 TypeScript 模块**（`export function apply(ctx)`），与 DSH 同进程、同生命周期（`ctx.effect` 卸载即清理）。
- DeepTutor 是 **Python 进程**。所以原生插件无法"直接变成"DeepTutor，只有两条路：
  1. 用 TS 重写能力层 —— 对 RAG / 文档解析 / 10 条 capability 流水线**不现实**；
  2. 插件内用 **`ctx.subprocess` 起 DeepTutor Python 子进程** —— 这是**官方一等公民模式**：`subagent-claude-code`、`subagent-codex`、`subagent-acp`、`lsp-stdio` 全部经 `ctx.subprocess` 起外部进程。

于是问题从"能不能"变成"值不值"：

| 维度                       | B. MCP 桥                    | D. 原生插件（TS + `ctx.subprocess` 包 Python）          |
| -------------------------- | ---------------------------- | ------------------------------------------------------- |
| 开发语言                   | 只写 Python（DeepTutor 侧）  | 额外维护一个 TS / npm 包                                |
| 依赖面                     | **MCP 协议（稳定）**         | DSH 的 TS runtime API（随 12k+ commit 演进）            |
| 工具治理（门禁/超时/取消） | 免费获得（并入 `ctx.tools`） | 同样免费（也注册进 `ctx.tools`）                        |
| UI 卡片                    | ❌ 只有 generic + 图片       | ✅ `presentCall` / `presentResult` / `presentationMeta` |
| 后台任务                   | 自己造 job_id 轮询           | ✅ `ctx.jobs.start()` 原生                              |
| 动态 skill 目录            | 手工拷 SKILL.md              | ✅ `ctx.skills.registerProvider()`                      |
| 一等 web provider          | ❌                           | ✅ `ctx.web`                                            |
| slash 命令 / UI 插槽       | ❌                           | ✅ `ctx.commands` / `ctx.clientModules`                 |
| 与 DSH 升级的耦合          | 低                           | **高**                                                  |

**结论：分层混搭，不做二选一。**

- 占约 80% 的"工具面"（`deeptutor_run` / `kb_search` / `memory_*`）继续走 **MCP 桥**：跨语言、只依赖稳定协议、零 TS 维护。
- 只在 MCP 够不到的三处上原生插件：**UI 卡片**（把 DeepTutor 的结果渲染成原生卡片）、**`ctx.jobs`**（长任务）、**`ctx.skills` provider**（动态目录）。

**落地形态（关键设计）**：只写**一个** TS 插件 `dsh-plugin-deeptutor`，内部用 `ctx.subprocess` 拉起**同一个** Python sidecar —— 即复用 §8 的 `deeptutor mcp serve` 进程，MCP 协议退居为**插件与 sidecar 之间的内部 RPC**，插件只负责把它"翻译"成 DSH 的原生缝。**一个 Python 进程，两种接法**，避免双份依赖、双份索引、双份账单。

---

## 5. 分阶段实施计划

P0 → P5 递进，每阶段都能独立验收（验收命令见 §9）。动手前务必先读 §5.0——它记录了会让桥直接跑不起来的实现约束。

### 5.0 实现要点（已核对的代码事实，动手 P1 前必读）

> 本节每一条都对应仓库里的实际代码，直接决定桥能不能跑起来。**骨架代码如果照抄网上"包一层 CLI"的做法会失败**，原因在 3、4、5 条。

1. **入口必须做与 HTTP server 一致的启动副作用**。[api/main.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/api/main.py#L22-L23) 在模块导入期就调用 `ensure_runtime_settings_files()` + `export_runtime_settings_to_env(overwrite=True)`；DSH 是**新起一个进程**，若 MCP 入口不做同样的事，[runtime_settings.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/config/runtime_settings.py#L765-L814) 的 `render_environment()` 里那批"从 settings 派生到 env"的键就会全体缺失——例如 `DISABLE_SSL_VERIFY`（连自签证书的 LLM 网关要靠它）、`DEEPTUTOR_SANDBOX_ALLOW_SUBPROCESS`（`exec` 工具的子进程开关）、`CHAT_ATTACHMENT_DIR`、`BACKEND_PORT`/`FRONTEND_PORT`，行为与 Web/CLI 路径不一致。这两句话要放在 `mcp_server` 模块顶层。

2. **容器只初始化一次，进程退出时统一关闭**。`DeepTutorApp()` 内部走 [get_application_container()](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/app/container.py#L398-L402) 的进程级单例，`start_turn()` 会自动 `await container.start()`，重复调用是幂等的。不要每次工具调用新建容器；在 server 生命周期结束时调用一次 `close_application_container()`。

3. **绝对不要复用 `stream_turn_as_json()`**。[common.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor_cli/common.py#L185-L203) 里它是用 `console.print(json.dumps(item))` 往 rich console（= **stdout**）打 NDJSON 的。stdio 传输下 stdout 就是 MCP 协议帧本身，任何一次 print 都会把协议冲坏（表现为 DSH 侧连接随机断开、`listTools` 超时）。正确做法是直接 `async for event in app.stream_turn(turn_id)` 在进程内收集，**全程不 print**。

4. **绝对不要复用 `maybe_run()`**。[common.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor_cli/common.py#L857-L871) 的 `finally` 里会 `close_application_container()`——它是为"一次调用即退出"的 CLI 设计的。MCP server 是常驻进程，用它会在第一次工具调用后就把容器关掉，第二次调用直接失败。

5. **`build_turn_request()` 是 keyword-only 且 10 个参数全必填**（[签名](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor_cli/common.py#L829-L854)）。`TurnRequest` 的其余字段（`skills` / `mcp` / `memory_references` / `llm_selection` / `workspace_id` …）走 dataclass 默认值；`workspace_id` 用 `model_fields_set` 判定是否显式传入（[facade.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/app/facade.py#L138-L142)），所以"MCP 侧不传"≠"传入 None"。

6. **拿最终答案要读 `result` 事件**。`StreamEventType` 全量定义见 [stream.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/core/stream.py#L17-L34)。capability 的统一收尾是 `emit_capability_result()`，它调用 `stream.result(payload)`，而 `StreamBus.result` 把 payload **塞进 `event["metadata"]`**（[stream_bus.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/runtime/stream_bus.py#L313-L325)）：
   - 答案文本 → `event["metadata"]["response"]`
   - 用量 → `event["metadata"]["cost_summary"]`（`total_tokens` / `total_calls` / `total_cost_usd`）
   - 引用 → 单独的 `sources` 事件，`event["metadata"]["sources"]`

   注意 `content` 事件是**分片**的（`trace_kind == "llm_chunk"` 按 `call_id` 归并、由 `call_status` 的 `call_role` 收尾），自己拼容易漏；以 `result.response` 为准。

7. **`ask_user` 在 headless 下会挂死**。CLI 的做法见 [common.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor_cli/common.py#L302-L313) 的 `_ask_user_payload()`：检测到 `tool_result` 里带 `tool_metadata.ask_user` 就 `submit_user_reply(text="")` 自动作答。MCP 没有 elicitation 消费方，桥里必须做同样的事，否则该轮永远不结束，直到 `toolCallTimeoutMs` 判死。

8. **取消要桥接**。DSH 的 `callTool(..., { signal })` 会传取消信号；MCP Python SDK 的 `Context` 暴露 `request_context`。桥里应在取消时调 `app.cancel_turn(turn_id)`，否则 DSH 侧放弃了、DeepTutor 侧的 LLM 还在烧 token。

9. **RAG 检索入口是 `RAGService.search()`**，签名 `search(query, kb_name, event_sink=None, rewrite=None, **kwargs) -> dict`（[service.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/rag/service.py#L126-L150)），返回体含 `query` / `answer` / `content` / `sources` / `provider` / `error_type`。**注意 PageIndex 系 provider 会返回 `error_type="reasoning_as_retrieval_required"`**——这类知识库必须在 agent loop 内用 PageIndex 工具读，`kb_search` 对它无效，工具描述里要写清。

10. **若选 `streamable-http`，挂载点要自己接 lifespan**。FastMCP 的 ASGI app 自带 session manager，而 [api/main.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/api/main.py#L108-L109) 已经有一个完整的 `lifespan`（含容器启动、迁移、后台 leader）。两者不能各自为政，必须合并成一个 lifespan，否则要么 MCP session manager 没启动、要么容器被重复初始化。**这是 P1 选 stdio 的主要理由**——stdio 没有这个问题。

### P0 — 基线与冒烟（不改代码）

目标：证明 DSH 能"看见"DeepTutor，并且本机 DeepTutor 环境可跑。

1. 把根 [SKILL.md](file:///Users/zhanglei/MyProjects/DeepTutor/SKILL.md) 复制为 skill。**注意 DSH 的"项目根"是会话 cwd 的最近 `.git` 祖先**，所以放到 DeepTutor 仓库里的 `.dsh/skills` 只有在"在 DeepTutor 目录下启动 DSH"时才生效；希望全局可用就装到用户级根（rank 400/500）：

   ```bash
   # 选项 A：项目级（rank 100）——仅在 DeepTutor 目录内启动 DSH 时生效
   mkdir -p /Users/zhanglei/MyProjects/DeepTutor/.dsh/skills/deeptutor-cli
   cp /Users/zhanglei/MyProjects/DeepTutor/SKILL.md \
      /Users/zhanglei/MyProjects/DeepTutor/.dsh/skills/deeptutor-cli/SKILL.md

   # 选项 B：用户级（rank 400，全局可用）
   mkdir -p ~/.dsh/skills/deeptutor-cli
   cp /Users/zhanglei/MyProjects/DeepTutor/SKILL.md ~/.dsh/skills/deeptutor-cli/SKILL.md
   ```

2. 验证 CLI 出口：
   ```bash
   cd /Users/zhanglei/MyProjects/DeepTutor
   .venv/bin/python -m deeptutor_cli.main run chat "用一句话解释傅里叶变换" --format json --language zh
   ```
3. 验证 DSH 侧已识别：在 DSH 里输入 `/deeptutor-cli`（用户显式注入路径），或看会话日志
   ```bash
   zstdcat ~/.dsh/sessions/*/*/session*.jsonl.zstd | grep -E "skills" | head
   ```
4. 记录基线：本机是否已装 `dsh`（`dsh --version`）、Python 3.13 环境、DeepTutor `.venv`。

**验收**：DSH 里能通过 `/deeptutor-cli` 或模型自动触发 skill；`deeptutor run ... --format json` 每行输出一个合法 JSON。

### P1 — 最小可用 MCP 桥（推荐主线起点）

目标：3 个工具跑通端到端。

改动点（DeepTutor 侧，新增）：

- `deeptutor/mcp_server/__init__.py` + `server.py`：FastMCP 实例、启动副作用与工具注册。**实现约束见 §5.0**——尤其不要复用 `stream_turn_as_json()` 与 `maybe_run()`。
- `deeptutor_cli/mcp.py` + 在 [main.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor_cli/main.py) 注册 `deeptutor mcp serve [--transport stdio|http] [--port]`（参数面可直接对齐 `run_capability`：`--kb` / `--session` / `--language` / `--config`）

工具清单（最小集，命名保持 `verb_noun`，DSH 会加 `mcp__deeptutor__` 前缀）：

| 工具            | 签名（建议）                                                                                                     | 实现依据                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deeptutor_run` | `(capability: str, message: str, session_id?: str, kb?: list[str], config?: dict) -> {ok, text, sources, usage}` | `DeepTutorApp.start_turn()` + `stream_turn()` 进程内收敛事件；答案取 `result.metadata.response`，用量取 `result.metadata.cost_summary`（见 §5.0-3/4/6） |
| `kb_search`     | `(kb: str, query: str, top_k?: int) -> {results: [{text, source, score}]}`                                       | 直接调 `RAGService.search()`（见 §5.0-9）                                                                                                               |
| `kb_ingest`     | `(kb: str, paths: list[str]) -> {job_id, status}`                                                                | 现有解析 + 索引链路（**长任务必须异步化**，见 P2）                                                                                                      |

DSH 侧配置（`cordis.yml` patch 或 profile 配置）：

```yaml
- id: deeptutor-mcp
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: deeptutor
    transport: stdio
    command: /Users/zhanglei/MyProjects/DeepTutor/.venv/bin/python
    args: ["-m", "deeptutor_cli.main", "mcp", "serve", "--transport", "stdio"]
    cwd: /Users/zhanglei/MyProjects/DeepTutor
    env:
      DEEPTUTOR_HOME: /Users/zhanglei/MyProjects/DeepTutor
    toolCallTimeoutMs: 120000
```

（若已在跑 `deeptutor serve`，可改用 `transport: streamable-http` + `url`。除鉴权 header 外还要解决 lifespan 冲突——FastMCP 的 session manager 必须并进 [api/main.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/api/main.py#L108-L109) 已有的 `lifespan`，详见 §5.0-10。）

**验收**：会话日志中可见 `mcp__deeptutor__kb_search` 调用；返回内容进入模型上下文；`tools/pre-execute` 门禁对该工具生效。

### P2 — 契约与治理

- **返回契约**：统一 `{ ok, data, error, usage }`；文本结果做裁剪（工具结果直接进上下文，容易膨胀）；图片/PDF 产物走 DSH 唯一支持的富结果桥（rc.7 起 PNG/JPEG/WebP/GIF 可进 durable 图像块）。
- **长任务异步化**：`kb_ingest` / `deep_research` 返回 `job_id`，配 `job_status` 轮询工具（MCP 调用默认 60s 超时，务必不让单次 `callTool` 阻塞）。
- **错误语义**：区分"工具失败"与"任务失败"，避免 DSH 侧误判为中断。
- **用量回报**：把 `UsageTracker.summary()`（`total_tokens` / `total_calls` / `total_cost_usd`）带进返回值或 DSH trace 元数据，解决"两套账单"的可见性问题。
- **冷启动**：`faiss-cpu` / `llama-index` 首次导入较慢，建议 server 常驻（stdio 常驻由 DSH 维持）+ 预导模块，避免每次调用重建索引连接。

### P3 — 深度能力接入

1. **全量 Capability 工具面**：把 `deep_solve` / `deep_question` / `visualize` / `math_animator` / `video_lesson` 以 `deeptutor_run(capability=...)` 单入口暴露（参数用 JSON Schema 描述），不作为长任务时保持单轮语义。
2. **长流程走 subagent（路径 C）**：`deep_research` 这类多阶段任务委派给 DeepTutor，DSH 只订阅 `progress` 类事件；参 [deepseek_harness.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/subagent/deepseek_harness.py) 的既有事件映射反向设计进度回报。
3. **会话/工作区对齐**：明确取舍——(a) 无状态：每次 `deeptutor run` 不传 `--session`，避免双份会话；(b) 有状态：用 DSH `session_id` 作为 DeepTutor `--session`，仅当确实需要跨轮记忆时启用，并接受两套持久化并存。
4. **技能层加厚**：把 capability 的 stage 说明与产物约定写成独立 `SKILL.md`（例如 `deep-research`、`quiz-generation`），让模型"知道何时该调 `deeptutor_run`"，而不是只看到工具名。

### P4 — 分发与协作

- **npm 包装包**：`dsh-plugin-deeptutor`（TS，薄壳：检测本机 Python/DeepTutor、注入上面的 MCP 配置、可选用 `ctx.clientModules` 做 KB 管理 UI 插槽），发布后打 `dsh-plugin` topic。
- **可复现实验**：提供一个 `cordis.yml` overlay + 一段可复制的验证脚本，降低他人接入成本。
- **双向闭环**：DeepTutor 侧把"反向桥"（DSH 作为 subagent，已实现）与"正向桥"（DSH 调 DeepTutor）写进同一份文档，形成生态互操作叙事。

### P5 — 可选：原生插件增强（路径 D，§4.3）

只有当 P1–P4 跑通、且确实需要 MCP 够不到的能力时才做。**前置条件：P1 的 Python sidecar 已经稳定。**

1. **`ctx.subprocess` 接管 sidecar 生命周期**：插件 `apply()` 里用 `ctx.subprocess` 拉起 sidecar，用 `ctx.effect` 注册还原；MCP 协议退居插件↔sidecar 的内部 RPC。
2. **`ctx.jobs` 替掉自造 job_id**：把 `kb_ingest` 从"自己维护轮询表"改为 `ctx.jobs.start({ kind, label, owner: exec.agent, run })`，白拿 jobId、cancel、readOutput、owner 清理。
3. **工具 UI 卡片**：给 `deeptutor_run` / `kb_search` 补 `presentCall` / `presentResult` + `output.presentationMeta`，把结果渲染成原生卡片（回放可重现）。
4. **`ctx.skills` provider**：用 `registerProvider()` 把 DeepTutor 的 capability/KB 目录**动态**生成成 skill，替掉 P0 的手工拷贝。
5. **按需再考虑**：`ctx.web`（`paper_search` / `zotero_search` 做一等 provider）、`ctx.commands`（`/kb` slash 命令）。
6. **守住边界**：插件**不注册 agent loop、不碰 session 持久化**——否则又变成双 loop / 双会话语义。

---

## 6. 关键设计决策（含取舍）

| 决策              | 选项                                         | 取舍与建议                                                                                                                                                                     |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 谁拥有 agent loop | DSH 单 loop / 双 loop                        | **DSH 单 loop**。DeepTutor 只在被显式委派时跑内部 loop                                                                                                                         |
| MCP 传输          | `stdio` / `streamable-http`                  | 一次性、无服务 → `stdio`；已有常驻 `deeptutor serve` 或需要多客户端共享 → `streamable-http`                                                                                    |
| 会话              | 无状态单轮 / 共享 session id                 | 默认**无状态**；仅当需要跨轮记忆时映射 DSH `session_id`                                                                                                                        |
| 模型与费用        | DSH 的 provider / DeepTutor 的 model_catalog | 工具调用建议用**DSH 的模型配置**（`DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL`）以免账单分裂；DeepTutor 的独立模型（如讯飞星辰自定义端点）仅用于其内部子流程，并在返回值里回报用量 |
| 上下文预算        | 全量返回 / 裁剪摘要                          | 工具结果**必须裁剪**（默认摘要 + 引用列表，正文按需二次取）                                                                                                                    |
| 富结果            | 文本 / 图像                                  | 只有图像会被 DSH 桥成 durable 内容块；音频与资源链接会退化为文本，产物建议落盘 + 回传路径                                                                                      |
| Windows           | 支持 / 不支持                                | DSH 的持久 PTY 后端不支持 Windows；跨平台时优先 stdio + 纯 Python 路径                                                                                                         |

---

## 7. 风险与对策

| 风险                  | 现象                                               | 对策                                                                                                            |
| --------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 双 loop 语义冲突      | 两层取消/重试/预算、事件乱序                       | 严守单 loop 原则；Capability 仅在 subagent 形态下自有 loop                                                      |
| MCP 调用超时          | `kb_ingest`、`deep_research` 超过 60s 被判定失败   | 异步 job + 轮询；显式调大 `toolCallTimeoutMs`                                                                   |
| 上下文膨胀            | 检索结果整段入库，token 暴涨                       | 摘要 + `top_k` 限制 + 二次取正文                                                                                |
| 冷启动与依赖          | `faiss` / `llama-index` 首次导入慢；用户机器缺依赖 | server 常驻；把重型 RAG 依赖做成可选 module（`deeptutor module list` 已有机质），并在工具报错里给出明确安装指引 |
| Skills 与 Prompt 混淆 | 以为 MCP 能提供 skill/prompt                       | MCP 只桥接 tools；skill 走文件目录或插件 provider                                                               |
| 命名冲突              | 多实例同 `serverName` 后装失败                     | 固定 `serverName: deeptutor`，不要重复装载                                                                      |
| 权限与安全            | 模型通过工具执行高权操作                           | 依赖 DSH `tools/pre-execute` 门禁 + DeepTutor 侧沙箱/降噪白名单；工具描述写清副作用                             |

---

## 8. 附录：可直接复制的片段

以下是可直接落地的配置与骨架代码。**§8.3 的 Python 骨架是按 §5.0 的代码事实写成的**，与"包一层 CLI"的常见写法有三处关键差异，注释里已标出。

### 8.1 DSH 侧：stdio 配置

```yaml
- id: deeptutor-mcp
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: deeptutor
    transport: stdio
    command: /Users/zhanglei/MyProjects/DeepTutor/.venv/bin/python
    args: ["-m", "deeptutor_cli.main", "mcp", "serve", "--transport", "stdio"]
    cwd: /Users/zhanglei/MyProjects/DeepTutor
    env:
      DEEPTUTOR_HOME: /Users/zhanglei/MyProjects/DeepTutor
    # 单次 callTool 超时（默认 60000）；与激活期 listTools 的 60s 上限无关
    toolCallTimeoutMs: 120000
    # 初始连接/同步失败时是否拒绝激活（默认 false）。
    # Python 侧冷启动重（faiss/llama-index），先保持 false 让它延迟就绪；
    # 若要快速暴露配置错误，改成 true 换取"启动即失败"的确定性。
    failOnStartupError: false
    reconnect:
      enabled: true # 默认即 true
      initialDelayMs: 500 # 首次重连延迟，连续失败翻倍
      maxDelayMs: 30000 # 退避上限
      maxAttempts: 10 # 每次断连的连续失败上限，超过则注销工具
```

### 8.2 DSH 侧：远程（复用已在运行的后端）

```yaml
- id: deeptutor-mcp-http
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: deeptutor
    transport: streamable-http
    url: http://127.0.0.1:8001/mcp
    headers:
      Authorization: !!js "`Bearer ${process.env.DEEPTUTOR_TOKEN}`"
```

### 8.3 DeepTutor 侧：MCP server 骨架（**待实现，非现有文件**）

> 下面是**按 §5.0 的事实写出的最小骨架**，与"包一层 CLI"的常见写法有三处关键差异，已在注释里标出。真实实现还需要补上取消桥接与 `kb_ingest` 的异步 job。

```python
# deeptutor/mcp_server/server.py —— 规划中的新增文件
from __future__ import annotations

from mcp.server.fastmcp import FastMCP

# 差异 1：入口补齐与 api/main.py 相同的启动副作用（§5.0-1）。
# 必须放在模块顶层、在构造容器之前。
from deeptutor.services.config import (
    ensure_runtime_settings_files,
    export_runtime_settings_to_env,
)

ensure_runtime_settings_files()
export_runtime_settings_to_env(overwrite=True)

mcp = FastMCP("deeptutor")


async def _run_turn(
    *,
    capability: str,
    message: str,
    session_id: str | None = None,
    kb: list[str] | None = None,
) -> dict:
    """跑一轮并把事件流收敛成 {ok, text, sources, usage}。

    差异 2：完全不 print、不复用 maybe_run（§5.0-3/4）。
    差异 3：答案与用量从 result 事件的 metadata 取，不自己拼 content 分片（§5.0-6）。
    """
    from deeptutor.app import DeepTutorApp
    from deeptutor_cli.common import build_turn_request

    app = DeepTutorApp()  # 进程级 container 单例，start_turn 会自动 start（§5.0-2）
    request = build_turn_request(  # keyword-only，10 个参数全必填（§5.0-5）
        content=message,
        capability=capability,
        session_id=session_id,
        tools=[],
        knowledge_bases=kb or [],
        language="zh",
        config_items=[],
        config_json=None,
        notebook_refs=[],
        history_refs=[],
    )
    _session, turn = await app.start_turn(request)
    turn_id = turn["id"]

    text = ""
    sources: list[dict] = []
    usage: dict = {}
    async for event in app.stream_turn(turn_id):
        kind = event.get("type")
        meta = event.get("metadata") or {}
        if kind == "result":
            text = str(meta.get("response") or "")
            usage = meta.get("cost_summary") or {}
        elif kind == "sources":
            sources.extend(meta.get("sources") or [])
        elif kind == "tool_result" and _is_ask_user(meta):
            # headless 下必须自答，否则该轮永不结束（§5.0-7）
            await app.submit_user_reply(turn_id, text="")
    return {"ok": True, "text": text, "sources": sources, "usage": usage}


def _is_ask_user(meta: dict) -> bool:
    tool_meta = meta.get("tool_metadata")
    ask = tool_meta.get("ask_user") if isinstance(tool_meta, dict) else None
    return bool(isinstance(ask, dict) and ask.get("questions"))


@mcp.tool()
async def deeptutor_run(
    capability: str,
    message: str,
    session_id: str | None = None,
    kb: list[str] | None = None,
) -> dict:
    """运行一个 DeepTutor capability（单轮）。返回 {ok, text, sources, usage}。"""
    return await _run_turn(capability=capability, message=message, session_id=session_id, kb=kb)


@mcp.tool()
async def kb_search(kb: str, query: str, top_k: int = 8) -> dict:
    """在指定知识库中检索，返回 {results: [{text, source, score}]}。

    注意：PageIndex 系知识库不走本地检索，会返回
    error_type="reasoning_as_retrieval_required"（§5.0-9）。
    """
    from deeptutor.services.rag import RAGService

    payload = await RAGService().search(query=query, kb_name=kb)
    return {"results": payload.get("sources") or [], "provider": payload.get("provider")}
```

**生命周期收尾**：stdio server 退出时应调用一次 `close_application_container()`（[container.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/app/container.py#L410-L420)），否则恢复服务、后台 leader、子进程都不会被优雅释放。

---

## 9. 验收矩阵

每个阶段用**可复制的命令**验收，不靠"看起来能跑"。

| 阶段 | 验收项                 | 命令 / 观察点                                                                                                                                                         |
| ---- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0   | DSH 已装               | `dsh --version`                                                                                                                                                       |
| P0   | CLI 出口是机器可读     | `cd /Users/zhanglei/MyProjects/DeepTutor && .venv/bin/python -m deeptutor_cli.main run chat "用一句话解释傅里叶变换" --format json --language zh` → 每行一个合法 JSON |
| P0   | DSH 识别到 skill       | 会话日志 `zstdcat ~/.dsh/sessions/*/*/session*.jsonl.zstd \| grep -E "skills" \| head`；或在 DSH 里输入 `/deeptutor-cli`                                              |
| P1   | MCP 组合已装载         | `dsh web --dump-config \| grep -A3 mcp`                                                                                                                               |
| P1   | 工具名带前缀           | 会话日志 `zstdcat ~/.dsh/sessions/*/*/session*.jsonl.zstd \| grep -E '"mcp__' \| head` → `mcp__deeptutor__deeptutor_run` / `mcp__deeptutor__kb_search`                |
| P1   | **stdio 协议未被污染** | 工具连续调用 **≥3 次** 都成功（第 1 次成功不代表没污染：协议错位通常在第 2–3 次才暴露）；日志里没有 `Unexpected token` / 连接断开                                     |
| P1   | headless 不挂死        | 触发一个会走 `ask_user` 的 capability，观察该轮在 `toolCallTimeoutMs` 内返回而不是超时                                                                                |
| P2   | 用量回报可见           | 返回值里含 `usage.total_tokens`；与 `data/user/usage.sqlite3` 的口径能对上                                                                                            |
| P2   | 长任务不阻塞           | `kb_ingest` 立即返回 `job_id`，`job_status` 能轮询到 `completed`                                                                                                      |
| P3   | 深度 capability        | `deeptutor_run(capability="deep_research", ...)` 端到端产出报告；DSH 侧上下文未见爆炸（工具结果已裁剪）                                                               |
| P3   | 取消被桥接             | 在 DSH 里中断一个长任务，DeepTutor 侧日志显示 `cancel_turn` 被调用                                                                                                    |
| P5   | 插件不产生双 loop      | `dsh web --dump-config` 里没有新增 agent-loop / session-persistence 条目；DSH 侧仍是唯一 loop                                                                         |
| P5   | 卡片可回放             | 触发一次带 UI 卡片的调用 → 刷新页面从 session 日志回放，卡片内容**与首次一致**（验证 `presentationMeta` 的纯度）                                                      |

## 10. 参考来源

> 下列 DSH 事实已于本次调研中**逐条打开原文核对**（`deepseekdocs.com` 的 MCP / 技能系统页、官网、npm 检索），与本文表格一致。

**DeepSeek Harness**

- [DeepSeek Harness 官网](https://www.deepseek.com/en/harness/)（Cordis「everything is a plugin」、`npx @deepseek-ai/dsh web`、Creator mode、dev tools trace 面板）
- [deepseek-ai/deepseek-harness（GitHub）](https://github.com/deepseek-ai/deepseek-harness)
- [开发者文档 · Your first plugin](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/)（`apply(ctx)`、`inject`、三种插件形态、`cordis.yml` 注册、`ctx.effect` 自动清理）
- [能力缝参考 · Capability Seams](https://deepseek-harness.github.io/deepseek-harness/en/reference/capability-seams)（Service Definition / Provider / Consumer 三角色；`ctx.skills` / `ctx.jobs` / `ctx.web` / `ctx.subprocess` 等全量缝与实现包，§1.5 与 §4.3 的依据）
- [能力分层实践 · Three-role capability design](https://deepseek-harness.github.io/deepseek-harness/en/develop/practice/)（`ctx.plugin` 组合 provider/consumer；何时拆包）
- [工具创作参考 · Tool authoring](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-tool)（`defineTool`、`exec.signal`、`ctx.jobs.start()` 长任务、UI 卡片 `presentCall`/`presentResult`/`presentationMeta`、Code Mode）
- [指南 · Python SDK](https://deepseek-harness.github.io/deepseek-harness/en/guide/python-sdk)
- [指南 · Quickstart](https://deepseek-harness.github.io/deepseek-harness/en/guide/quickstart)
- [技能系统](https://deepseekdocs.com/docs/features/skills)（skill 根目录 rank 100–500、frontmatter 字段、`ctx.skills` 三个接口、`skill` 工具、调用策略）
- [MCP 集成](https://deepseekdocs.com/docs/features/mcp)（`dsh-mcp-client` 完整字段表、`mcp__<server>__<raw>` 命名、重连语义、rc.7 图像富结果、验证命令）
- [Cordis 论文](https://arxiv.org/abs/2608.25512)（"everything is a plugin" 架构来源）
- [@deepseek-ai/dsh-mcp-client 社区索引](https://npm.io/package/@crazx/dsh-mcp-client)（配置示例交叉验证）
- [Running an MCP Server Inside DeepSeek Harness](https://www.bytebell.ai/blog/mcp-server-deepseek-harness-plugin/)（"桥接 vs 插件"边界讨论）

**DeepTutor 代码（本文引用）**

- [deeptutor/services/subagent/deepseek_harness.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/subagent/deepseek_harness.py)（既有反向桥：SDK 优先 + headless 兜底 + DSH 事件映射）
- [deeptutor_cli/main.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor_cli/main.py#L77-L121)（`run` 命令与 `--format json`）
- [deeptutor_cli/common.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor_cli/common.py#L829-L871)（`build_turn_request` 签名、`stream_turn_as_json` 的 stdout 打印、`maybe_run` 的容器关闭）
- [deeptutor/app/facade.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/app/facade.py#L129-L179)（`DeepTutorApp` 门面：`start_turn` / `stream_turn` / `cancel_turn` / `submit_user_reply`）
- [deeptutor/app/container.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/app/container.py#L398-L420)（进程级容器单例与 `close_application_container`）
- [deeptutor/runtime/stream_bus.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/runtime/stream_bus.py#L313-L325)（`result` 事件把 payload 放进 metadata）
- [deeptutor/core/stream.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/core/stream.py#L17-L34)（`StreamEventType` 全量）
- [deeptutor/services/rag/service.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/rag/service.py#L126-L150)（`RAGService.search` 签名与返回体）
- [deeptutor/api/main.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/api/main.py#L22-L23)（启动副作用与既有 lifespan）
- [SKILL.md](file:///Users/zhanglei/MyProjects/DeepTutor/SKILL.md)（已是 DSH 兼容 skill 格式）
- [requirements/core.txt](file:///Users/zhanglei/MyProjects/DeepTutor/requirements/core.txt#L21)（`mcp` 为核心依赖 → FastMCP 可用）
- [deeptutor/services/mcp/manager.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/mcp/manager.py)（现有 MCP 客户端）
- [deeptutor/api/routers/](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/api/routers)（`knowledge.py` / `memory.py` / `capabilities.py` / `subagents.py` 等 HTTP 面）
