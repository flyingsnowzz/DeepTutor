> **中文译本**：本文件由英文原文翻译；命令、路径、配置键、代码块和链接目标保持原样，如译文与实现存在歧义，以英文原文和当前代码为准。

# DeepTutor × DeepSeek Harness 集成调研与方案

> 目标：把DeepTutor的资产用进DeepSeek Harness（DSH），而不是把DeepTutor整个搬进DSH。
> 本文分四部分：DSH事实调研→DeepTutor可搬动资产盘点→价值判断→执行方案。

---

## 0.结论（TL;DR）

**最有价值的不是DeepTutor的harness内核，而是它的「领域能力层+知识/RAG层」。**

DSH 已经自带 Harness 的全部核心：智能体循环、工具系统与门禁、会话持久化与中继、沙箱、定时任务、子智能体、MCP 桥、技能系统、UI。DeepTutor 重叠的部分（编排器、Turn 服务、事件链路、Web 前端、会话库）搬过去造成**双智能体循环 / 双会话衔接**，是负资产。

DSH 生态缺、而 DeepTutor 已经做完成了：

| 排序 | 资产 | 为什么在 DSH 里有价值 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | **知识库/RAG + 多格式文档解析**（PDF/DOCX/PPTX/XLSX → 索引 → 检索 → 引用） | DSH 默认工具是`bash/read/grep/edit`级别的文件操作，没有“把一本书变成可检索知识库”的队列；它的官方记忆插件（Engram/Memorix 等）是选择加入外部 MCP 示例，不是面向文档语言料的 RAG |
| 2 | **多阶段能力模拟**（`deep_research` / `deep_solve` / `deep_question` / `visualize` / `math_animator` / `video_lesson`） | DSH 的技巧是“Markdown 指令层”，长流程编排仍靠模型即兴发挥；DeepTutor 把这些流程固化成了代码级阶段流水线，是可直接复用的“成品工作流” |
| 3 | **学习/掌握度与学业**（`deeptutor/learning/`：mastery、grading、policy） | DSH无响应概念 |
| 4 | **用量本+定价+跟踪**（usage.sqlite3、cost_summary） | DSH 有痕迹（开发者面板），但账单口径的分类账是 DeepTutor 的独立资产 |

**接入推荐形态**：把DeepTutor降级为**“工具/技能提供方”**，DSH保持唯一主循环。

> “能不能直接外接 DSH 插件”：MCP 桥**本身就是 DSH 插件**（官方 `@deepseek-ai/dsh-mcp-client`）；自研自带插件的边界与取舍 **§4.3**，可行但那几个 MCP 够不到的“缝”才值得写 TS。

> 动手写MCP桥之前请先读**§5.0实现要点**——那里记录了三个会使直接桥跑不起来的坑（stdout被CLI打印污染、`maybe_run`关闭常驻容器、答案不在`content`事件里）。

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

首先把它“是什么、能扩展什么、做桥接必须知道哪些运行时语义”分三层说清楚。本节所有 DSH 事实均来自官方文档原核对（见§10）。

### 1.1 定位与架构

DSH 是 DeepSeek 官方开源的 **agent harness**（不是模型），基于 [Cordis](https://github.com/cordiverse/cordis) 的「**一切都是插件**」内核：模型、工具、技能、会话、沙箱、存储、智能体循环、调度、UI **全部是插件**，可通过替换配置或扩展，重写 DSH 源码。

- 启动： `npx @deepseek-ai/dsh web` （Web UI，默认 `http://127.0.0.1:3080`）
- 源码：<https://github.com/deepseek-ai/deepseek-harness>
- 插件生态：GitHub topic `dsh-plugin` （社区站统计已核验上万插件）

### 1.2 四条扩展缝（重点）

| 塔 | 机制 | 你能得到什么 | 关键限制 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **插件** | TS 模块导出`apply(ctx)`；`export const inject = ['tools']`声明依赖；`ctx.tools.register(defineTool(...))`；`ctx.effect(fn)`注册清理 | 进程内一等公民工具/服务/UI插槽 | 需 TypeScript + npm 包；修改的是 DSH 进程 |
| **技能** | `<root>/<name>/SKILL.md`（frontmatter `name`/`description`必填，kebab-case）或覆盖`<name>.md`；根按排名扫描：`<projectRoot>/.dsh/skills`(100) → `.agents/skills`(200) → `customSkillDirs`(300) → `<dshHome>/skills`(400) → `~/.agents/skills`(500)；也有插件`ctx.skills.register()` / `registerProvider()`提供 | 逐步给出指令层，模型交叉`list()` → `get(name)`展开全文 | 只是 Markdown 指令，不能自带强类型工具 |
| **MCP** | 官方插件`@deepseek-ai/dsh-mcp-client`，一个插件实例 = 一个 MCP 服务器；`transport: stdio`或`streamable-http`；工具并入`ctx.tools`，公开名为`mcp__<serverName>__<rawName>` | **一行配置**把外部工具纳入DSH工具治理（`tools/pre-execute`门禁、超时、取消） | 只桥接工具，**资源/提示无消费方**；`toolCallTimeoutMs`默认60000；**激活期`listTools()`有60s上限（继承MCP SDK）**，与`toolCallTimeoutMs`是两码事 |
| **子智能体** | DSH 自带子智能体插件，把子任务委派给其他智能体 | 长流程委派，后续循环不阻塞 | 双循环/双会话目标需明确切分 |

### 1.3 运行时通信（做桥接必须知道）

- **事件双轨**： `agent/*` 负责实时队列与状态， `session/event` 负责**持久回放**。
- **转生命周期**： `pre-step` → `request` → 工具执行 → `step/end` → `turn/end`。
- **模型请求里的工具调用事件**： `assistant/chunk` （`text-delta` / `reasoning-delta`）、 `tool/call`、 `tool/result`、 `turn/end` （`reason.data.reason.kind == "error"` 表示失败）。

    > 这套模式 DeepTutor 已经实现过一遍了 —— 见 [deepseek_harness.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/subagent/deepseek_harness.py#L258-L324)，它把上述事件映射成 DeepTutor 的 `EVENT_TEXT / EVENT_REASONING / EVENT_TOOL / EVENT_TOOL_RESULT / EVENT_ERROR`。做正向桥时可以反向复用这套知识。

- **Python SDK**： `pip install deepseek-harness-sdk`， `from deepseek_harness import DeepSeekHarness`，以 `cordis.yml` 组合定义智能体能力面， `session_root` 落 JSONL 会话日志； `DeepSeekHarness` 懒启动内置运行时并在静脉管理器内复用。

    > DeepTutor同样已经用了它—— [deepseek_harness.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/subagent/deepseek_harness.py#L167-L243)，包含 `dsh_home`、 `reasoning_effort`、 `on_notification` 回调等。**结论：两端桥存在的“方向”方向已经且有生产级细节实现，正向方向（DSH 调 DeepTutor）目前空缺。**

### 1.4 L1/L2的文档与SDK差异（易踩坑）

- 一个插件实例只对应一个MCP服务器；同名`serverName`的后装实例会失败。
- 工具名会规范化到 DeepSeek 函数名契约（≤64 个字符、 `[A-Za-z0-9_-]`），超长时追加 12 位哈希。
- MCP启动超时继承MCP SDK默认**60秒**；不响应的服务器会拖慢激活与清理。

### 1.5 能力缝（能力接缝）——原生插件能挂哪些点

DSH 把“可替换的能力”拆成**服务定义/提供商/消费者** 三角色（[官方能力接缝全量图谱](https://deepseek-harness.github.io/deepseek-harness/en/reference/capability-seams)）。对 DeepTutor 有意义的缝隙：

| 缝 | 联合体 | 内置实现 | 对 DeepTutor 的意义 |
| ----------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `ctx.skills`                        | 技能提供者 | `skill-filesystem` / `skill-badge` | 用`registerProvider()` **动态生成**能力/KB目录为技能，取代手工·SKILL.md |
| `ctx.jobs`                          | 后期任务 | `jobs-local` / `tool-jobs` | `kb_ingest`直接复用官方作业运行时（jobId、cancel、readOutput、owner清理） |
| `ctx.tools`                         | 工具栏 + 受控执行栏（政策前 / 防护 / 调度周围 / 政策后 / 结果） | `tool-fs` / `tool-bash` / `tool-web` … | 门禁、超时、取消、编码模式全部免费 |
| `ctx.web`                           | 网络访问提供商有机 | `web-search-exa` / `web-search-perplexity` / `web-fetch-http` | `paper_search` / `zotero_search`可外接一等网络提供商 |
| `ctx.commands`                      | 人类园艺 | — | `/kb`、`/cap`等人类斜线命令 |
| `ctx.clientModules`                 | 客户端插件图（UI） | — | 双方结果配合 |
| `ctx.storage` / `ctx.storageDomain` | 非会话存储 / 领域数据设施 | `storage-json` / `storage-sqlite` | KB指数、掌握耐久化程度状态 |
| `ctx.subprocess`                    | 子进程缝 | `subprocess-local` / `subprocess-e2b` | **跨语言解法的官方出口**（见§4.3） |

工具侧还有两处只有原生插件才拿得到（MCP工具拿不到）：

- **UI反馈**： `presentCall` / `presentResult` 返回 `card` 渲染效果（`generic` / `terminal` / `diff` / `search` / `web`），配 `output.presentationMeta` 将反馈数据持久化在 `tool/result`上，**会话回放也能覆盖**。MCP工具只能落到通用的配合，最终结果仅限于图片。
- **异步通知**：`exec.agent.inject({ content, source })`把耐久上下文追加进模型的**下一次**请求。

---

## 2. 调研：DeepTutor 有哪些可搬资产

对照§1得到的DSH能力面，逐项盘点DeepTutor的资产：哪些是DSH的真实缺口、哪些已经重叠、搬运成本各是多少。结论先看§2.1的表，§2.2是其中几项“顺手能够拿”的红利。

### 2.1 资产 × 可搬性 × DSH 是否存在

| 资产 | 代码位置 | DSH 是否存在 | 可搬性 | 建议 |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------- |
| 能力模拟（deep_research 等10个） | [deeptutor/功能/](file:///Users/zanglei/MyProjects/DeepTutor/deeptutor/capability) | 无（只有提示级技能） | 高（`deeptutor run <cap> --format json`已是稳定入口） | **搬家** |
| 知识库/RAG/文档解析 | [deeptutor/services/rag/](file:///Users/zanglei/MyProjects/DeepTutor/deeptutor/services/rag)、`deeptutor/knowledge/`、`requirements/modules/parsing.txt` | 无（记忆插件是选择加入外部示例） | 高 | **优先搬迁** |
| 学习/掌握度/体育 | [deeptutor/learning/](file:///Users/zanglei/MyProjects/DeepTutor/deeptutor/learning) | 无 | 中（强领域连接） | 二期 |
| 工具集（`paper_search` / `zotero_search` / `brainstorm` / `reason` / `geogebra_analysis` / `imagegen` / `videogen`） | [deeptutor/tools/builtin/](file:///Users/zanglei/MyProjects/DeepTutor/deeptutor/tools/builtin) | 部分（bash/read/grep 等通用工具） | 高（`ToolDefinition`已经是JSON Schema，几乎可以直译成MCP工具） | **搬家** |
| 用量本+账面定价 | `data/user/usage.sqlite3`、`deeptutor/logging/stats/` | 跟踪有，账单口径无 | 高 | 三期（回报给DSH） |
| 供应商/型号目录 | [deeptutor/services/llm/provider_registry.py](file:///Users/zanglei/MyProjects/DeepTutor/deeptutor/services/llm/provider_registry.py) | **有**（设置→模型，支持自定义OpenAI兼容端点） | 低 | **不搬** |
| 编译内核排（`ChatOrchestrator` / `TurnEngine` / `TurnApplicationService`） | [orchestrator.py](file:///Users/zanglei/MyProjects/DeepTutor/deeptutor/runtime/orchestrator.py)、[turn_engine.py](file:///Users/zanglei/MyProjects/DeepTutor/deeptutor/runtime/turn_engine.py) | **有**（agentloop本身就是插件） | 低 | **不搬**（双循环风险） |
| StreamBus / 会话持久化 / 重放 | [stream_bus.py](file:///Users/zanglei/MyProjects/DeepTutor/deeptutor/runtime/stream_bus.py)、`deeptutor/services/session/` | **有**（`session/event`持久回放） | 低 | **不搬** |
| Web前端（Next.js） | [web/](文件:///Users/zanglei/MyProjects/DeepTutor/web) | **有**（且是 DSH 的强项：UI 插槽`ctx.slots`） | 低 | **不搬** |
| MCP **客户端** | [deeptutor/services/mcp/](file:///Users/zanglei/MyProjects/DeepTutor/deeptutor/services/mcp)（`manager.py`使用`mcp.client.streamable_http`） | **有** | — | 保留，是DeepTutor自己消费MCP的能力 |

### 2.2 四个“零成本/亮点”发现

1. **DeepTutor 根目录的 [SKILL.md](file:///Users/zhanglei/MyProjects/DeepTutor/SKILL.md#L1-L4) 已经是 DSH 兼容格式**：frontmatter 为 `name: deeptutor-cli` + `description`，即 DSH `skill-filesystem` 要求的字段（`name` kebab-case、 `description` 必填）。把它复制到`.dsh/skills/deeptutor-cli/SKILL.md`即可被DSH扫描到，**零代码**。
2. **MCP 服务器侧依赖已就绪**：[requirements/core.txt](file:///Users/zhanglei/MyProjects/DeepTutor/requirements/core.txt#L21) 里 `mcp>=1.26.0,<2.0.0` 是核心依赖， `mcp.server.fastmcp.FastMCP` 可直接使用，**不需要新增依赖**。
3. **CLI 已提供机器入口**：[main.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor_cli/main.py#L77-L121) 的 `deeptutor run <capability> <message> --format json`，包含 `--session` / `--kb` / `--tool` / `--config-json` / `--workspace`，是理想的桥接基础。
4. **HTTP面也基本齐了**：[deeptutor/api/routers/](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/api/routers) 已有 `knowledge.py` / `memory.py` / `capabilities.py` / `question.py` / `skills.py` / `subagents.py`， `streamable-http` 方案无需复用新写休息。

---

## 3.判断：哪一部分最有价值

用统一判据给§2的资产排序，并运算为什么“最像利用内核的那部分”**整个不搬**——这是方案里最容易做错的一步。

### 3.1 判据

> 价值=（DSH缺口大小）×（DeepTutor成熟度）×（迁移成本可控性）

三个要素缺一不可：缺口小则搬迁了也无增量（如提供商）；市场度低则等于把未完成品带进新的比重（如掌握度）；成本失控则长期维持反而拖累（如搬动内核）。

### 3.2 排序结论

| 名次 | 资产 | 缺口 | 职业度 | 迁移成本 | 结论 |
| ----- | ---------------------------- | ---- | ------------------------------- | ---------------------------- | ------------------------------ |
| **1** | 知识库/RAG+文档解析 | 大 | 高（解析→索引→检索→引用全图书馆） | 中（MCP桥即可） | **最值得做，先做** |
| **2** | 能力范例 | 大 | 高（10条级管道） | 中（CLI/SDK已有JSON出口） | 第二优先，首要同族工具+技能 |
| 3 | 学习/掌握度/体育 | 大 | 中 | 中高（领域数据模型） | 三期 |
| 4 | 用量本 | 小 | 高 | 低 | 三期，作为“可回归” |
| — | 提供者/harness内核/UI | 无 | — | — | **不做** |

### 3.3 为什么“harness 内核”不值得搬（反例转换）

- **语义冲突**：DSH的转（`pre-step → request → tool → step/end → turn/end`）与DeepTutor的转（`capability.run()` + `StreamBus`事件+`emit_capability_result()`）是**两套等价语义**。同时会出现：两层布局、两层取消、两层重试、多重表格。
- **DSH 的循环是插件**：意味着它不是“要替换的组件”，而是“可组合的初始化”。正确的姿势是**寄生**，而不是**替换**。
- **维护成本**：搬动内核同等承诺紧随 DSH 的 12k+ 提交演进；搬动“能力层”则只依赖稳定出口（CLI `--format json` / REST / MCP 协议）。

---

## 4. 方案总览

先给整体架构与四条任选路径的横向对比，再另外展开新增的**路径D（原有DSH插件）**。

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

| 路径 | 形态 | 数量 | 优点 | 侧面 | 适用 |
| ---------------------- | ------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| **一个。技能直投** | 复制`SKILL.md`到`.dsh/skills/` | **0 代码** | 重新可用；无进程、无依赖 | 模型需自己拼CLI；无包装返回；无门禁 | 打底、演练、教学 |
| **B。 MCP桥（主线）** | 新增`deeptutor mcp serve`（FastMCP）+ DSH `mcp-client`配置 | 中（1个新模块+1段补丁） | 官方支持路径；自动获得超时/取消/门禁；工具名命名空间干净 | 只桥接工具（资源/提示无效）；长任务需异步化；stdin/stdout 协议调试略烦 | **知识库、单轮能力、记忆/笔记本** |
| **C。子智能体长流程** | DSH 侧把多阶段任务委派给 DeepTutor | 中高 | 长流程不支撑爆破下部；可恢复全部阶段的能力 | 双循环/双会话需治理；细节与成本需返回 | `deep_research`、`deep_question`、`math_animator` |
| **D。 原生 DSH 插件** | 自研 TS 插件，内部用`ctx.subprocess`拉起 DeepTutor Python sidecar | 高（多维护一个TS/npm包） | 拿到MCP够不到的缝：UI调整、`ctx.jobs`、skillsprovider、webprovider、slash命令 | 连接DSH的TS运行时API（演进快）；跨语言进程管理要自己兜 | 见§4.3 |

**推荐组合：A（打底）+ B（主力）+ D（只在MCP够不到处处用）+ C（仅限长流程）**，并且严格守住“**单循环原则**”：

- 走B时，DeepTutor以**无循环的工具**身份存在（单轮 `deeptutor run`，一次一次调用返回）。
- 只要走C时，DeepTutor才跑自己的循环，必须且由DSH **显式委派**、踩一次、结果与用量显式返回。
- 走D时，插件本身**不跑循环**，它只是把DeepTutor sidecar的出口“重新包装”成DSH的原始缝。

### 4.3 路径 D：原生 DSH 插件（TS + `ctx.subprocess`）

**先破除一个误解：走MCP不等于“不是插件”。** `@deepseek-ai/dsh-mcp-client` **本身就是DSH插件**（注册进 `cordis.yml`）。A/B/C全插件都在插件体系内，区别只是**用通用桥接插件，还是自研专用**。

那“把DeepTutor变成原生插件”到底可不可用？——**可以，但有一条硬边界**：

- DSH 插件 = **进程内 TypeScript 模块**（`export function apply(ctx)`），与 DSH 同进程、同周期生命（`ctx.effect` 卸载即清理）。
- DeepTutor 是 **Python 进程**。所以原生插件无法“直接变成”DeepTutor，只有备用路：
    1. 使用 TS 重写能力层 —— 对 RAG / 文档解析 / 10 条能力模拟**不现实**；
    2. 插件内用 ** `ctx.subprocess` 起 DeepTutor Python 子进程** ——**官方一等公民模式**： `subagent-claude-code`、 `subagent-codex`、 `subagent-acp`、 `lsp-stdio` 全部经 `ctx.subprocess` 起外部进程。

那么问题从“能不能”变成“值不值”：

| 维度 | B.MCP桥 | D. 原生插件（TS + `ctx.subprocess`包 Python） |
| -------------------------- | ---------------------------- | ------------------------------------------------------- |
| 开发语言 | 只写Python（DeepTutor侧） | 额外维护一个 TS/npm 包 |
| 依赖面 | **MCP协议（稳定）** | DSH 的 TS 运行时 API（随 12k+ 提交演进） |
| 工具治理（门禁/超时/取消） | 免费获得（并入`ctx.tools`） | 同样免费（也注册进`ctx.tools`） |
| UI 对应 | ❌只有通用+图片 | ✅ `presentCall` / `presentResult` / `presentationMeta` |
| 后台任务 | 自己造 job_id 轮询 | ✅ `ctx.jobs.start()`布拉 |
| 动态技能目录 | ▲技能.md | ✅ `ctx.skills.registerProvider()` |
| 一等网络提供商 | ❌ | ✅ `ctx.web` |
| 斜杠 命令 / UI 插槽 | ❌ | ✅ `ctx.commands` / `ctx.clientModules` |
| 与 DSH 升级的连接 | 低 | **高** |

**结论：分层混搭，不做二选一。**

- 占约80%的“工具面”（`deeptutor_run` / `kb_search` / `memory_*`）继续走**MCP桥**：跨语言、只依赖稳定协议、零TS维护。
- 只在 MCP 够不到的三处上同步插件：**UI 配合**（把 DeepTutor 的结果渲染成同步配合）、** `ctx.jobs` **（长任务）、** `ctx.skills` 提供者**（动态目录）。

**落地形态（关键设计）**：只写**一个** TS 插件 `dsh-plugin-deeptutor`，内部用 `ctx.subprocess` 拉**同一个插件** Python sidecar —— 即复用 §8 的 `deeptutor mcp serve` 进程，MCP 协议退居**插件与 sidecar 之间的内部 RPC**，只负责把“翻译”成 DSH 的接缝。**一个 Python进程，两种接法**，避免双份依赖、双份索引、双份账单。

---

## 5.分阶段实施计划

P0 → P5 递进，每阶段独立验收（验收见§9）。必须前命令务必先读§5.0——记录了会让桥直接跑不起来的实现约束。

### 5.0 实现要点（已核对的代码事实，必需 P1 前必读）

> 本每一条都对应仓库里的实际代码，直接决定桥不能跑起来。**重构代码如果照抄网上“包层CLI”的做法会失败**，原因在3、4、5条。

1. **入口必须做与 HTTP 服务器一致的启动响应**。[api/main.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/api/main.py#L22-L23) 在模块导入期就调用 `ensure_runtime_settings_files()` + `export_runtime_settings_to_env(overwrite=True)`；DSH 是**新起一个进程**，若 MCP 入口不做同样的事，[runtime_settings.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/config/runtime_settings.py#L765-L814) 的 `render_environment()`里那批“从设置派生到env”的键可以全体解除——例如`DISABLE_SSL_VERIFY`（连自签证书的LLM网关要靠它）、`DEEPTUTOR_SANDBOX_ALLOW_SUBPROCESS`（`exec`工具的子进程开关）、`CHAT_ATTACHMENT_DIR`、`BACKEND_PORT` / `FRONTEND_PORT`，行为行为与Web/CLI路径一致。 `mcp_server`模块。

2. **容器只初始化一次，进程退出时统一关闭**。 `DeepTutorApp()` 内部走 [get_application_container()](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/app/container.py#L398-L402) 的进程级单例， `start_turn()` 会自动 `await container.start()`，重复调用是幂等的。不要每次工具调用容器新建；在服务器生命周期结束时调用一次 `close_application_container()`。

3. **绝对复不要用 `stream_turn_as_json()` **。[common.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor_cli/common.py#L185-L203) 里它是用 `console.print(json.dumps(item))` 往 rich console（= **stdout**）打 NDJSON 的。stdio 传输下 stdout 就是 MCP 协议帧本身，任何时候打印都会把协议冲坏（通过 DSH 侧连接随机断开、 `listTools`超时）。正确做法是直接在进程内收集`async for event in app.stream_turn(turn_id)`，**全程不打印**。

4. **绝对不要复用 `maybe_run()` **。[common.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor_cli/common.py#L857-L871) 的 `finally` 里会 `close_application_container()` ——它是为“一次调用即退出”的 CLI 设计的。MCP 服务器是常驻进程，用它会在第一次工具调用后将容器关掉，第二次调用直接失败。

5. ** `build_turn_request()` 是关键字且 10 个参数全必填**（[签名](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor_cli/common.py#L829-L854)）。 `TurnRequest` 的其余字段（`skills` / `mcp` / `memory_references` / `llm_selection` / `workspace_id` …）走数据类默认值； `workspace_id` 用 `model_fields_set` 判定是否显式判定（[facade.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/app/facade.py#L138-L142)），所以“MCP 侧不传”≠“判定 None”。

6. **拿它的最终答案应该读`result`事件**。`StreamEventType`完整定义量见[stream.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/core/stream.py#L17-L34)。能力的统一收尾是`emit_capability_result()`，称为`stream.result(payload)`，而`StreamBus.result`有效负载**塞进`event["metadata"]` **（[stream_bus.py]( file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/runtime/stream_bus.py#L313-L325）：
      - 答案文本 → `event["metadata"]["response"]`
      - 用量→`event["metadata"]["cost_summary"]`（`total_tokens` / `total_calls` / `total_cost_usd`）
      - 引用→单独的`sources`事件，`event["metadata"]["sources"]`

   注意`content`事件是**分片**的（`trace_kind == "llm_chunk"`按`call_id`归并、由`call_status`的`call_role`收尾），自己拼容易漏；与`result.response`同样。

7. ** `ask_user` 在 headless 下会挂死**。CLI 的做法见 [common.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor_cli/common.py#L302-L313) 的 `_ask_user_payload()`：检测到 `tool_result` 里带 `tool_metadata.ask_user` 就 `submit_user_reply(text="")` 自动作答。MCP 没有引出消费方，桥里必须做同样的事，否则该轮永远不结束，直到`toolCallTimeoutMs`判死。

8. **取消要桥接**。DSH 的 `callTool(..., { signal })` 会传取消信号；MCP Python SDK 的 `Context` 引入 `request_context`。桥里应在取消时调节 `app.cancel_turn(turn_id)`，否则 DSH 侧面放弃了、DeepTutor 侧面的 LLM 还在烧 token。

9. **RAG搜索入口是`RAGService.search()` **，签名`search(query, kb_name, event_sink=None, rewrite=None, **kwargs) -> dict`（[service.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/rag/service.py#L126-L150)），返回体含`query` / `answer` / `content` / `sources` / `provider` / `error_type`。**注意PageIndex系提供者会返回 `error_type="reasoning_as_retrieval_required"` **——此类知识库必须在智能体循环内用 PageIndex 工具读，`kb_search` 对它无效，工具描述里要写清。

10. **若选 `streamable-http`，挂载点要自己接寿命**。FastMCP 的 ASGI app 自带会话管理器，而 [api/main.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/api/main.py#L108-L109) 已经有一个完整的 `lifespan` （含容器启动、迁移、后台领导）。两者不能分别为政，必须合并成一个寿命，否则或者 MCP 会话管理器没启动或容器被重复初始化。**这是P1选stdio的主要理由**——stdio没有这个问题。

### P0 — 基线与冒烟（不改代码）

目标：证明 DSH 能“看见”DeepTutor，并且本机 DeepTutor 环境可运行。

1. 把根 [SKILL.md](file:///Users/zhanglei/MyProjects/DeepTutor/SKILL.md) 复制为技能。**注意 DSH 的“项目根”是会话 cwd 的最近 `.git` 祖先**，所以把 DeepTutor 仓库里的 `.dsh/skills` 仅在“在 DeepTutor 目录下启动 DSH”时才生效；希望全局可用就安装到用户级根（排名 400/500）：

   ```bash
   # 选项 A：项目级（rank 100）——仅在 DeepTutor 目录内启动 DSH 时生效
   mkdir -p /Users/zhanglei/MyProjects/DeepTutor/.dsh/skills/deeptutor-cli
   cp /Users/zhanglei/MyProjects/DeepTutor/SKILL.md \
      /Users/zhanglei/MyProjects/DeepTutor/.dsh/skills/deeptutor-cli/SKILL.md

   # 选项 B：用户级（rank 400，全局可用）
   mkdir -p ~/.dsh/skills/deeptutor-cli
   cp /Users/zhanglei/MyProjects/DeepTutor/SKILL.md ~/.dsh/skills/deeptutor-cli/SKILL.md
   ```

2. 验证CLI出口：
   ```bash
   cd /Users/zhanglei/MyProjects/DeepTutor
   .venv/bin/python -m deeptutor_cli.main run chat "用一句话解释傅里叶变换" --format json --language zh
   ```
3. 验证DSH侧已识别：在DSH里输入`/deeptutor-cli`（用户显式注入路径），或看会话日志
   ```bash
   zstdcat ~/.dsh/sessions/*/*/session*.jsonl.zstd | grep -E "skills" | head
   ```
4. 记录基线：本机是否已安装`dsh`（`dsh --version`）、Python 3.13环境、DeepTutor `.venv`。

**验收**：DSH里能通过`/deeptutor-cli`或模型自动触发技能；`deeptutor run ... --format json`每行输出一个合法的JSON。

### P1 — 最小可用MCP桥（推荐主线起点）

目标：3个工具运行结果。

这一点（DeepTutor 侧，新增）：

- `deeptutor/mcp_server/__init__.py` + `server.py`：FastMCP实例、启动副作用与工具注册。**实现约束见§5.0**——尤其不要复用 `stream_turn_as_json()` 和 `maybe_run()`。
- `deeptutor_cli/mcp.py` + 在 [main.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor_cli/main.py) 注册 `deeptutor mcp serve [--transport stdio|http] [--port]` （参数面可直接连接 `run_capability`： `--kb` / `--session` / `--language` / `--config`）

工具清单（最小集，命名保持 `verb_noun`，DSH 会加 `mcp__deeptutor__` 海外）：

| 工具 | 签名（建议） | 实际引用 |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deeptutor_run` | `(capability: str, message: str, session_id?: str, kb?: list[str], config?: dict) -> {ok, text, sources, usage}` | `DeepTutorApp.start_turn()` + `stream_turn()`进程内消耗事件；答案取`result.metadata.response`，用量取`result.metadata.cost_summary`（见§5.0-3/4/6） |
| `kb_search`     | `(kb: str, query: str, top_k?: int) -> {results: [{text, source, score}]}`                                       | 直接调节`RAGService.search()`（见§5.0-9） |
| `kb_ingest`     | `(kb: str, paths: list[str]) -> {job_id, status}`                                                                | 现有解析+索引仓库（**长任务必须异步化**，见P2） |

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

（若已在跑 `deeptutor serve`，可改用 `transport: streamable-http` + `url`。除鉴权头外还要解决寿命冲突——FastMCP 的会话管理器必须并进 [api/main.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/api/main.py#L108-L109) 已有的 `lifespan`，参见§5.0-10。）

**验收**：会话日志中可见 `mcp__deeptutor__kb_search` 调用；返回内容进入模型上下文； `tools/pre-execute` 门禁该工具生效。

### P2——契约与治理

- **返回契约**：统一`{ ok, data, error, usage }`；文本结果做处理（工具结果直接进上下文，容易膨胀）；图片/PDF产物走DSH唯一支持的富结果桥（rc.7起PNG/JPEG/WebP/GIF可进持久图像块）。
- **长任务化异步**： `kb_ingest` / `deep_research` 返回 `job_id`，配 `job_status` 轮询工具（MCP 调用默认 60s 超时，务必不要让单次 `callTool` 阻塞）。
- **错误提示**：区分“工具失败”与“任务失败”，避免DSH侧误判为中断。
- **用量返回**：把`UsageTracker.summary()`（`total_tokens` / `total_calls` / `total_cost_usd`）带进返回值或DSH跟踪元数据，解决“两套账单”的可视性问题。
- **冷启动**：`faiss-cpu` / `llama-index`首次导入较慢，建议服务器常驻（stdio常驻由DSH维持）+预导模块，避免每次调用重建索引连接。

### P3——深度接入能力

1. **全量能力工具面**：将 `deep_solve` / `deep_question` / `visualize` / `math_animator` / `video_lesson` 与 `deeptutor_run(capability=...)` 单入口引入（参数用 JSON Schema 描述），不作为长任务时保持单轮语义。
2. **长流程走子智能体（路径C）**： `deep_research` 此类多阶段任务委派给 DeepTutor，DSH 只订阅 `progress` 类事件；参 [deepseek_harness.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/subagent/deepseek_harness.py) 的捕捉事件映射反向设计进展回报。
3. **会话/工作区连**：明确取舍——(a)无状态：每次`deeptutor run`不传`--session`，避免双份会话；(b)有状态：用DSH `session_id`作为DeepTutor `--session`，仅当确实需要跨轮记忆时实现，并接受两套持久化并存。
4. **技能层加厚**：把能力的阶段说明与产物约定写成独立的`SKILL.md`（如`deep-research`、`quiz-generation`），让模型“何时该调`deeptutor_run`”，而不是只见工具名。

### P4——分发与协作

- **npm 包装包**： `dsh-plugin-deeptutor` （TS，薄壳：检测本机 Python/DeepTutor、注入上面的 MCP 配置、可选用 `ctx.clientModules` 做 KB 管理 UI 插槽），发布后打 `dsh-plugin` 主题。
- **可复现实验**：提供一个`cordis.yml`覆盖+一段可复制的验证脚本，降低其他接入成本。
- **双向闭环**：DeepTutor侧把“反向桥”（DSH作为子智能体，已实现）与“正向桥”（DSH调DeepTutor）写一份同一份文档，形成生态互操作叙述。

### P5 — 任选：婚姻插件增强（路径D，§4.3）

只有当 P1–P4 跑通、且确实需要 MCP 够不到的能力时才做。**前置条件：P1 的 Python sidecar 已经稳定。**

1. ** `ctx.subprocess` 接管 sidecar 生命周期**：插件 `apply()` 里用 `ctx.subprocess` 拉起 sidecar，用 `ctx.effect` 注册插件还原；MCP 协议退居↔sidecar 的内部 RPC。
2. ** `ctx.jobs` 替掉自建 job_id**：把 `kb_ingest` 从“自己维护轮询表”改为 `ctx.jobs.start({ kind, label, owner: exec.agent, run })`，白拿 jobId、取消、readOutput、所有者清理。
3. **工具UI交互**：给 `deeptutor_run` / `kb_search` 补 `presentCall` / `presentResult` + `output.presentationMeta`，把结果渲染成误差反馈（回放可重复）。
4. ** `ctx.skills` 提供者**：用 `registerProvider()` 把 DeepTutor 的能力/KB 目录**动态**生成生成技能，替换掉 P0 的手工副本。
5. **中间再考虑**： `ctx.web` （`paper_search` / `zotero_search` 做一等提供商）、 `ctx.commands` （`/kb` 斜杠命令）。
6. **守住边界**：插件**不注册智能体循环、不碰会话持久化**——否则又变成双循环 / 双会话语义。

---

## 6.关键设计决策（含取舍）

| 决策 | 选项 | 取舍与建议 |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 谁拥有智能体循环 | DSH 单环/双环 | **DSH单循环**。DeepTutor只在被显式委派时跑内部循环 |
| MCP传输 | `stdio` / `streamable-http` | 瞬时、无服务 → `stdio`；已有常驻`deeptutor serve`或需要多客户端共享 → `streamable-http` |
| 会话 | 无状态单轮 / 共享会话 id | 默认**无状态**；仅当需要跨轮记忆时映射 DSH `session_id` |
| 模型与费用 | DSH 的提供者 / DeepTutor 的 model_catalog | 工具调用建议使用**DSH 的模型配置**（`DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL`）账单分割；DeepTutor 的独立模型（如讯飞星辰辰接口）仅用于其内部子流程，并在返回值里返回用量 |
| 上部预算 | 全部量返回 / 尺寸摘要 | 工具结果**必须**（默认+引用列表，正文后续第二取） |
| 富结果 | 文本/图像 | 唯一图像会被DSH桥生成耐用的内容块；音频与资源链接会损坏为文本，产物建议落盘+回传路径 |
| 视窗 | 支持/不支持 | DSH 的持久 PTY 硬件不支持 Windows；跨平台时优先 stdio + 纯 Python 路径 |

---

## 7.风险与对策

| 风险 | 现象 | 对策 |
| --------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 双环语义冲突 | 两层取消/重试/预算、事件乱序 | 严守单循环原则；能力仅在子智能体形态下自有循环 |
| MCP调用超时 | `kb_ingest`、`deep_research`超过 60s 被判定失败 | 异步作业+轮询；显式调大`toolCallTimeoutMs` |
| 上下文膨胀 | 搜索结果整段入库，代币暴涨 | 摘要 + `top_k`限制 + 二次取正文 |
| 冷启动与依赖 | `faiss` / `llama-index`首次导入慢；用户机器缺依赖 | 服务器常驻；将重型 RAG 依赖必需可选模块（`deeptutor module list`已有机质），并在工具报错中给出明确的安装指引 |
| 技巧与提示语法 | 认为 MCP 能够提供技能/提示 | MCP 只桥接工具；技能走文件目录或插件提供商 |
| 命名冲突 | 多实例同`serverName`后安装失败 | 固定`serverName: deeptutor`，不要重复装载 |
| 权限与安全 | 模型通过工具执行高权操作 | 依赖 DSH `tools/pre-execute`门禁 + DeepTutor 侧沙箱/启用白名单；工具描述写清副 |

---

## 8. 附录：可直接复制的片段

以下是可直接落地的配置与重构代码。**§8.3 的 Python 重构是按 §5.0 的代码事实编写的**，与“包层 CLI”的常见写法有三处关键差异，注释里已标出。

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

### 8.2 DSH 侧：远程（复用已在运行的头部）

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

### 8.3 DeepTutor 侧：MCP 服务器组件（**待实现，非现有文件**）

> 下面是**按§5.0的事实写出的最小重构**，与“包层CLI”的常见写法有三处关键差异，已在注释里标出。真正实现还需要补取消上桥接与`kb_ingest`的异步作业。

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

**生命周期收尾**：stdio服务器退出时应调用一次`close_application_container()`（[container.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/app/container.py#L410-L420)），否则恢复服务、后台leader、子进程都不会被优雅释放。

---

## 9. 施工矩阵

每个阶段用**可复制的命令**验收，不靠“看起来能跑”。

| 阶段 | 验收项目 | 命令/观察点 |
| ---- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 | DSH 已安装 | `dsh --version`                                                                                                                                                       |
| P0 | CLI 出口是机器 | `cd /Users/zhanglei/MyProjects/DeepTutor && .venv/bin/python -m deeptutor_cli.main run chat "用一句话解释傅里叶变换" --format json --language zh` → 每行一个合法 JSON |
| P0 | DSH识别技能 | 会话日志`zstdcat ~/.dsh/sessions/*/*/session*.jsonl.zstd \| grep -E "skill"\| head`；或在 DSH 里输入 `/deeptutor-cli` |
| P1 | MCP 组合已装载 | `dsh web --dump-config \| grep -A3 mcp` |
| P1 | 工具名带出口 | 会话日志`zstdcat ~/.dsh/sessions/*/*/session*.jsonl.zstd \| grep -E '"mcp__' \| head` → `mcp__deeptutor__deeptutor_run` / `mcp__deeptutor__kb_search` |
| P1 | **stdio协议修复污染** | 工具连续调用 **≥3 次** 都成功（第 1 次成功不代表没污染：协议错误位通常在第 2-3 次才暴露）；日志里没有`Unexpected token` / 连接中断 |
| P1 | 无头不挂死 | 触发一个会走`ask_user`的能力，观察该轮在`toolCallTimeoutMs`内返回而不是超时 |
| P2 | 用药恢复可见 | 返回值里含`usage.total_tokens`；与`data/user/usage.sqlite3`的口径能力对上 |
| P2 | 长任务不阻碍 | `kb_ingest`立即返回`job_id`，`job_status`能轮询到`completed` |
| P3 | 深度能力 | `deeptutor_run(capability="deep_research", ...)`多肽定量报告；DSH 横向上下文未见爆炸（工具结果已如此） |
| P3 | 取消被桥接 | 在 DSH 里中断一个长任务，DeepTutor 侧日志显示`cancel_turn`被调用 |
| P5 | 插件不产生双循环 | `dsh web --dump-config`里没有新增智能体循环/会话持久性入口；DSH 侧仍然是唯一循环 |
| P5 | 响应可回放 | 触发一次带 UI 响应的调用 → 刷新页面从会话日志回放，响应内容**与首次一致**（验证`presentationMeta`的触发） |

## 10. 参考来源

> 以下 DSH 事实已于本次调研中**逐条打开原文核对**（`deepseekdocs.com` 的 MCP / 技能系统页、官网、npm 检索），与论文表格一致。

**DeepSeek 安全带**

- [DeepSeek Harness 官网](https://www.deepseek.com/en/harness/)（Cordis「一切都是插件」、 `npx @deepseek-ai/dsh web`、创作者模式、开发工具跟踪面板）
- [deepseek-ai/deepseek-harness（GitHub）](https://github.com/deepseek-ai/deepseek-harness)
- [开发者文档 · 你的第一个插件](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/)（`apply(ctx)`、 `inject`、 华丽插件形态、 `cordis.yml` 注册、 `ctx.effect` 自动清理）
- [缝能力参考 · Capability Seams](https://deepseek-harness.github.io/deepseek-harness/en/reference/capability-seams)（服务定义/提供商/消费者三角色；`ctx.skills` / `ctx.jobs` / `ctx.web` / `ctx.subprocess` 等全量缝与实现包，§1.5 与§4.3 的相关）
- [能力分层实践·三角色能力设计](https://deepseek-harness.github.io/deepseek-harness/en/develop/practice/)（`ctx.plugin`组合provider/consumer；何时拆包）
- [工具创作参考·工具创作](https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/adding-a-tool)（`defineTool`、 `exec.signal`、 `ctx.jobs.start()` 长任务、UI 姿势 `presentCall` / `presentResult` / `presentationMeta`、代码模式）
- [指南·Python SDK](https://deepseek-harness.github.io/deepseek-harness/en/guide/python-sdk)
- [指南·快速入门](https://deepseek-harness.github.io/deepseek-harness/en/guide/quickstart)
- [技能系统](https://deepseekdocs.com/docs/features/skills)（技能根目录排名100-500、frontmatter字段、`ctx.skills`三个接口、`skill`工具、调用策略）
- [MCP集成](https://deepseekdocs.com/docs/features/mcp)（`dsh-mcp-client` 完整字段表、 `mcp__<server>__<raw>` 命名、重连语义、rc.7 图像富结果、验证命令）
- [Cordis 论文](https://arxiv.org/abs/2608.25512)（“一切都是插件”架构来源）
- [@deepseek-ai/dsh-mcp-client 社区索引](https://npm.io/package/@crazx/dsh-mcp-client)（配置示例交叉验证）
- [在 DeepSeek Harness 中运行 MCP 服务器](https://www.bytebell.ai/blog/mcp-server-deepseek-harness-plugin/)（“桥接 vs 插件”边界讨论）

**DeepTutor 代码（引用）**

- [deeptutor/services/subagent/deepseek_harness.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/subagent/deepseek_harness.py)（主要逆向桥：SDK优先 + headless兜底 + DSH事件映射）
- [deeptutor_cli/main.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor_cli/main.py#L77-L121)（`run` 命令与 `--format json`）
- [deeptutor_cli/common.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor_cli/common.py#L829-L871)（`build_turn_request` 签名、 `stream_turn_as_json` 的标准输出打印、 `maybe_run` 的容器关闭）
- [deeptutor/app/facade.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/app/facade.py#L129-L179)（`DeepTutorApp` 门面： `start_turn` / `stream_turn` / `cancel_turn` / `submit_user_reply`）
- [deeptutor/app/container.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/app/container.py#L398-L420)（进程级容器单例与 `close_application_container`）
- [deeptutor/runtime/stream_bus.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/runtime/stream_bus.py#L313-L325)（`result` 事件把有效负载 负载元数据）
- [deeptutor/core/stream.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/core/stream.py#L17-L34)（`StreamEventType` 全部量）
- [deeptutor/services/rag/service.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/rag/service.py#L126-L150)（`RAGService.search` 签名与返回体）
- [deeptutor/api/main.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/api/main.py#L22-L23)（启动后续与主要生命周期）
- [SKILL.md](file:///Users/zhanglei/MyProjects/DeepTutor/SKILL.md)（已是 DSH 兼容技能格式）
- [requirements/core.txt](file:///Users/zhanglei/MyProjects/DeepTutor/requirements/core.txt#L21)（`mcp` 为核心依赖 → FastMCP 可用）
- [deeptutor/services/mcp/manager.py](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/services/mcp/manager.py)（现有MCP客户端）
- [deeptutor/api/routers/](file:///Users/zhanglei/MyProjects/DeepTutor/deeptutor/api/routers)（`knowledge.py` / `memory.py` / `capabilities.py` / `subagents.py` 等 HTTP 面）