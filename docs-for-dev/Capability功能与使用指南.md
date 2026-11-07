# DeepTutor Capability 功能与使用指南

> 适用版本：当前 1.7.0 源码布局  
> 整理日期：2026-11-04  
> 数量结论：当前官方模块声明了 **11 种用户可选择的 Capability**。  
> 注意：模块 installed/enabled/ready、模型与外部依赖、账号授权都会影响实际可用性；本文介绍能力契约，不代表每个部署都已完成相应配置。

## 1. Capability 是什么

Capability 是**接管一次完整 Turn 的任务能力**。它不仅回答一句话，还可以：

- 运行一个专用 Agent Loop。
- 执行多阶段 Pipeline。
- 挂载专属工具。
- 生成报告、题目、图、音频、视频等结果。
- 发出阶段、进度、来源、结果和错误等 StreamEvent。
- 通过统一结果封装返回响应与 `cost_summary`。

简化理解：

```text
用户选择 Capability
        ↓
ChatOrchestrator 找到对应实现
        ↓
Capability 决定这次任务怎样完成
        ↓
Agent / Pipeline 调用模型和工具
        ↓
输出文本、引用、题目、图形、音频或视频
```

Capability 与 Tool 的区别：

- **Capability**：完整任务，例如“做一次深度研究”。
- **Tool**：任务中的一个动作，例如“搜索一次网页”。

## 2. 当前 11 种 Capability 总览

| # | Capability | 中文理解 | 最适合的任务 | 所属模块 |
| --- | --- | --- | --- | --- |
| 1 | `chat` | 通用对话 | 问答、解释、写作、一般资料分析、工具组合 | `core` |
| 2 | `ask_questions` | 主动提问 | 需求不完整时，先通过高价值问题澄清再完成原任务 | `core` |
| 3 | `deep_solve` | 深度解题 | 数学、理科、编程等需要规划、分步求解和检查的问题 | `solve` |
| 4 | `deep_question` | 智能出题 | 自定义出题、按题型组卷、模仿样卷出题 | `questions` |
| 5 | `deep_research` | 深度研究 | 报告、研究笔记、对比分析、学习路径研究 | `research` |
| 6 | `visualize` | 通用可视化 | SVG、Mermaid、思维导图、Chart.js、交互 HTML、Manim 路由 | `visualize` |
| 7 | `math_animator` | 数学动画 | 用 Manim 生成数学讲解视频或分镜图 | `renderer-manim` |
| 8 | `mastery_path` | 掌握式学习 | 大纲、学习、测评、修复薄弱点、间隔复习 | `mastery` |
| 9 | `immersive_reading` | 沉浸式精读 | 基于文档、课件或媒体内容，带页码/章节/时间戳证据学习 | `reading` |
| 10 | `video_lesson` | 视频课程 | 用 Remotion 生成浏览器播放的动画课，可带 TTS 旁白 | `video-lesson` |
| 11 | `audio_overview` | 双人音频概览 | 把知识库或非空笔记生成双人对话音频与文字稿 | `audio-overview` |

### 2.1 为什么代码里的 Capability 目录看起来不止 11 个

`deeptutor/capabilities/` 还包含内部实现，例如：

- Partner/Subagent 代答的 handoff。
- 上下文探索。
- 与笔记、IMA、Obsidian 等功能绑定的内部接管逻辑。

它们不一定是用户在模式选择器中直接选择的正式 Capability。因此：

> **统计用户模式，应读取 `deeptutor/modules/manifests/*.json` 中的 `capabilities` 声明，而不是简单数目录。**

### 2.2 “已注册”不等于“一定能成功运行”

建议检查：

```bash
.venv/bin/deeptutor module list
.venv/bin/deeptutor plugin list
.venv/bin/deeptutor doctor --format json
```

- `module list`：检查 installed、enabled、ready。
- `plugin list`：查看注册的能力和工具。
- `doctor`：检查模型、凭据、存储等基础条件。
- 实际音频、视频、研究和 RAG 仍需各自的依赖和端到端验证。

`doctor --online` 会真实调用模型，可能产生费用。

## 3. 快速选择：我应该用哪一个

| 你的需求 | 首选 | 备选/组合 |
| --- | --- | --- |
| 随便问、解释概念、总结、写作 | `chat` | 需求模糊时先用 `ask_questions` |
| 帮我完善一个模糊需求 | `ask_questions` | 澄清后切回 `chat` 或其他能力 |
| 解一道数学/物理/编程题 | `deep_solve` | 简单问答用 `chat` 即可 |
| 根据教材出 10 道题 | `deep_question` | 生成后用 `deep_solve` 检查典型题 |
| 调研一个主题并形成报告 | `deep_research` | 只要简短概述时用 `chat` |
| 画流程图、架构图、数据图表 | `visualize` | 数学过程动画用 `math_animator` |
| 动态演示函数、几何或算法原理 | `math_animator` | 静态图解用 `visualize` |
| 系统学会一个知识点并持续复习 | `mastery_path` | 单次概念解释用 `chat` |
| 对照 PDF/课件/视频学习并引用出处 | `immersive_reading` | 跨主题外部调研用 `deep_research` |
| 生成一段完整动画讲解课 | `video_lesson` | 只演示数学过程用 `math_animator` |
| 把知识库变成双人播客式音频 | `audio_overview` | 只要文字摘要用 `chat` |

## 4. 通用使用方式

### 4.1 Web 页面

通常按以下顺序操作：

1. 在聊天模式中选择 Capability。
2. 按需附加知识库、文档、图片或其他材料。
3. 按需启用工具。
4. 如果右侧/活动面板出现 Capability 配置卡片，填写并确认。
5. 用一句话说明目标、受众、范围和期望产物。
6. 观察阶段、工具、来源和最终结果。

推荐提示词结构：

```text
目标：我想完成什么。
背景：我已经知道什么，材料是什么。
范围：必须包含和不要包含什么。
受众：初学者、大学生、教师、研发等。
产物：报告/题目/图/视频/音频及其格式。
约束：时长、数量、语言、风格、引用要求。
```

### 4.2 CLI 单次运行

```bash
.venv/bin/deeptutor run <capability> "你的任务" [选项]
```

常用选项：

| 选项 | 用途 |
| --- | --- |
| `--kb <名称>` | 附加知识库，可重复 |
| `--tool <名称>` / `-t` | 启用用户可切换工具，可重复 |
| `--config key=value` | 设置 Capability 配置，可重复 |
| `--config-json '<JSON>'` | 一次传入完整配置，适合数组、对象和嵌套结构 |
| `--session <id>` | 继续已有会话 |
| `--language zh` / `-l zh` | 指定回复语言 |
| `--format json` / `-f json` | 输出 NDJSON，便于其他 Agent 处理 |

示例：

```bash
.venv/bin/deeptutor run chat "用初学者能理解的方式解释傅里叶变换" -l zh

.venv/bin/deeptutor run deep_solve "求 sin(x^2) 的导数，并检查链式法则是否用对" -l zh

.venv/bin/deeptutor run deep_question "根据线性代数知识库出 5 道中等难度题" \
  --kb linear-algebra \
  --config num_questions=5 \
  --config difficulty=medium \
  -l zh

.venv/bin/deeptutor run deep_research "比较 RAG 与长上下文方案的适用边界" \
  --config-json '{"mode":"comparison","depth":"standard"}' \
  -l zh
```

### 4.3 交互式 REPL

```bash
.venv/bin/deeptutor chat
.venv/bin/deeptutor chat --capability deep_solve --kb math-textbook
```

REPL 内可以切换能力、工具、知识库和配置，并支持重新生成上一轮回答。适合连续调试提示词和配置。

### 4.4 Python SDK

```python
from deeptutor.app import DeepTutorApp

app = DeepTutorApp()
session, turn = await app.start_turn({
    "capability": "chat",
    "content": "解释傅里叶变换",
    "language": "zh",
})

async for event in app.stream_turn(turn["id"]):
    print(event)
```

配置通过 TurnRequest 的 `config` 字段传入。实际可用字段以后端 Capability schema 为准。

### 4.5 配置不要靠猜

当前请求 schema 的权威来源：

- `deeptutor/runtime/request_contracts.py`
- 各 Capability 的 `request_config.py`
- `deeptutor/modules/manifests/*.json`

许多配置模型使用 `extra="forbid"`：传错字段会直接报配置错误，而不是被悄悄忽略。

尤其注意：

- 当前 `deep_research` **没有** `sources` 请求配置项；资料来源通过工具、知识库和授权决定。
- 当前 `deep_solve` 请求配置为空对象；轮数、重规划等运行参数主要从设置读取，不要套用历史示例中的任意 config 键。
- `question_types`、`per_type_counts`、`confirmed_outline` 等结构化值建议使用 `--config-json`。

## 5. `chat` — 通用 Agent 对话

### 功能特点

- 默认 Capability。
- 采用 exploring → responding 的 Agent Loop。
- 可以按上下文挂载搜索、论文、Zotero、推理、GeoGebra、图像和视频工具。
- 附加知识库后可使用 RAG。
- 保留会话上下文，可结合工作区、笔记、记忆和其他授权资源。

### 最适合

- 概念解释、总结、翻译、写作。
- 一般学习问答。
- 需要少量工具组合的任务。
- 不需要专门 Pipeline 的轻量研究或分析。

### 使用技巧

1. **先默认使用 Chat，不要所有任务都上深度模式。** 简单问题用重型 Capability 只会增加时间和成本。
2. 说明受众和深度，例如“给高中生解释”“给工程师一份实现清单”。
3. 需要最新信息时明确启用 `web_search`，需要论文时启用 `paper_search`。
4. 需要基于自己的教材时附加知识库，不要只在提示词里写教材名称。
5. 工具按需开启，减少无关工具选择和额外调用。
6. 对重要事实要求“区分材料原文、检索证据和模型推断”。

### 示例

```text
根据附加的微积分知识库，用高中生能理解的方式解释链式法则。
先给一个直观比喻，再给一个完整例题，最后列出两个常见错误。
```

## 6. `ask_questions` — 主动澄清需求

### 功能特点

- 强制首轮 Agent Loop 通过 `ask_user` 收集信息。
- 根据完整对话历史提出有上下文的高价值问题。
- 目的不是只聊天，而是补齐原任务所需信息后完成任务。
- 每次显式选择该能力的 Turn，都会产生新的上下文提问，不要求它是对话第一轮。

### 最适合

- “帮我做一个学习计划”但缺少年级、时间和目标。
- “帮我生成一门课”但缺少受众、范围和时长。
- 需求模糊，直接生成很可能返工的任务。

### 使用技巧

1. 先给出真实目标，不要只发“你好”。
2. 提供已知约束，让系统把问题留给真正缺失的信息。
3. 认真回答问题卡片；答案会直接影响后续产物。
4. 简单事实问答不要使用它，否则只是增加交互步骤。
5. 澄清后可继续使用当前任务流程，或切换到更专门的 Capability。

### 示例

```text
帮我制定一份 8 周机器学习学习计划。我的目标是能完成一个入门项目。
请先问我最需要澄清的信息，再生成计划。
```

## 7. `deep_solve` — 规划、分步求解与重规划

### 功能特点

- 使用通用 Agent Loop，但进入 solve 模式。
- 挂载 `solve_plan`、`solve_finish_step`、`solve_replan` 等专属工具。
- 通过确定性计划状态约束模型：先规划、逐步完成、必要时有限重规划。
- 可结合 RAG、统一 `exec`、GeoGebra 和独立 `reason`。
- 运行轮数、重规划预算等从 solve 设置读取。

### 最适合

- 数学证明、计算、几何。
- 物理、化学等多步问题。
- 需要拆解和验证的编程题。
- 容易跳步或需要显式检查过程的问题。

### 使用技巧

1. 给出完整题目、已知条件、单位和所求，不要只发残缺公式。
2. 几何图片可同时提供清晰图片和文字条件，避免模型只猜图。
3. 附加对应教材知识库，可让符号、章节和课程口径更一致。
4. 要求“最后检查定义域、符号、边界条件或单位”，提高可审查性。
5. 简单口算不必使用 Deep Solve。
6. 对高风险计算，把结果与独立计算或教材答案交叉验证；Agent 的计划不等于数学正确性证明。

### 示例

```bash
.venv/bin/deeptutor run deep_solve \
  "证明 n^3-n 对任意整数 n 都能被 6 整除，并检查是否覆盖负整数" \
  --kb number-theory \
  -l zh
```

当前请求 config 为空对象，不要随意传 `detailed_answer` 等未声明字段。

## 8. `deep_question` — 自定义与仿真题生成

### 功能特点

- 两阶段：ideation → generation。
- `custom`：按主题、数量、难度和题型生成。
- `mimic`：参考样卷或题目风格生成。
- 可结合 RAG、网页搜索和执行工具。
- 支持题型白名单与各题型数量目标。

### 配置项

| 字段 | 可选值/范围 | 用法 |
| --- | --- | --- |
| `mode` | `custom`、`mimic`；默认 `custom` | 自定义或模仿 |
| `topic` | 字符串 | 补充主题；主要任务文本仍很重要 |
| `num_questions` | 1–50，默认 1 | 本次生成题数 |
| `difficulty` | 字符串 | 如 `easy`、`medium`、`hard`，也可写中文要求 |
| `question_types` | 字符串数组 | 限定题型；空数组由规划器选择 |
| `per_type_counts` | 对象 | 各题型数量；非空时总和应等于 `num_questions` |
| `paper_path` | 字符串 | 模仿模式的样卷/题目来源 |
| `max_questions` | 1–100，默认 10 | 相关生成/参考流程的数量上限 |

### 使用技巧

1. 第一次先出 5–10 题，检查质量后再扩量，不要直接生成 50 题。
2. 同时指定知识点、年级、题型、难度和是否附解析。
3. 使用 `per_type_counts` 时先算好总数。
4. 需要课程口径时附加教材知识库。
5. 模仿模式应提供足够清晰的样卷，说明“模仿结构和难度，不复制原题”。
6. 客观题答案、解析和重复题需要抽查；自动生成不等于教师已审定。

### 示例

```bash
.venv/bin/deeptutor run deep_question "为大一学生生成线性代数练习，附答案和解析" \
  --kb linear-algebra \
  --config-json '{
    "mode":"custom",
    "num_questions":6,
    "difficulty":"medium",
    "question_types":["single_choice","short_answer"],
    "per_type_counts":{"single_choice":4,"short_answer":2}
  }' \
  -l zh
```

题型字符串应与当前前端/题库支持的类型一致；不确定时先让规划器自动选择。

## 9. `deep_research` — 多阶段深度研究

### 功能特点

阶段：

```text
rephrasing → decomposing → researching → reporting
```

- 先澄清研究问题和拆解子主题。
- 对子主题进行迭代研究。
- 支持追加调查队列和报告生成。
- 可使用 RAG、网页、论文、预印本、研究审计、研究文献和执行工具。
- 结果可包含引用、研究过程和统一成本信息。

### 研究模式 `mode`

| 值 | 适合产物 |
| --- | --- |
| `notes` | 研究笔记、证据整理 |
| `report` | 结构化研究报告 |
| `comparison` | 多方案、多模型、多方法对比 |
| `learning_path` | 带资料依据的学习路线 |

### 深度 `depth`

| 值 | 使用建议 |
| --- | --- |
| `quick` | 快速了解范围、验证提示词和配置 |
| `standard` | 日常正式研究的默认选择 |
| `deep` | 更多子主题和迭代，耗时与成本更高 |
| `manual` | 手动控制子主题数、最大迭代数等 |

`mode` 和 `depth` 是必填项。

手动参数：

- `manual_subtopics`：校验后限制在 1–10。
- `manual_max_iterations`：校验后限制在 1–10。
- `confirmed_outline`：已确认大纲，用于继续按指定结构研究。

### 使用技巧

1. 明确研究问题、时间范围、地区/对象和不研究什么。
2. 比较模式要指定比较维度，例如成本、准确率、隐私、延迟和适用边界。
3. 先 `quick` 或 `standard`，确认拆解合理后再 `deep`。
4. 对大纲有明确意见时，先确认大纲，不要等最终报告才返工。
5. 最新网页信息启用 `web_search`，学术问题启用论文工具，课程材料附加知识库。
6. **不要传 `sources` config。** 当前源码明确说明没有这个请求配置项。
7. 区分“检索到摘要”“阅读全文”“代码静态审查”“实验复现”；研究工具不会自动证明实验已复现。
8. 对重要报告检查引用是否真正支持对应结论，并保留相互矛盾的证据。

### 示例

```bash
.venv/bin/deeptutor run deep_research \
  "比较长上下文与检索增强生成在企业知识问答中的成本、隐私、延迟和维护边界" \
  --tool web_search \
  --config-json '{"mode":"comparison","depth":"standard"}' \
  -l zh
```

手动深度示例：

```bash
.venv/bin/deeptutor run deep_research "整理 Transformer 的核心演进脉络" \
  --config-json '{
    "mode":"report",
    "depth":"manual",
    "manual_subtopics":4,
    "manual_max_iterations":3
  }' \
  -l zh
```

## 10. `visualize` — 图表、图解、流程和交互页面

### 功能特点

- analyzing → generating → reviewing。
- 自动分析内容并选择可用 visualizer。
- 通过 `submit_visualization` 校验和提交画布负载。
- 也可路由到 Manim 视频/图片阶段。

当前核心 visualizer 包括：

| ID | 最适合 |
| --- | --- |
| `svg` | 精确解释性插图、自定义结构图 |
| `mermaid` | 流程、时序、状态、类、ERD、时间线 |
| `mindmap` | 层级大纲、知识结构、思维导图 |
| `chartjs` | 柱状、折线、饼图、雷达等定量图表 |
| `html` | 自包含交互课程、步进器和模拟 |

还可能有用户/插件提供的 visualizer，实际 ID 以当前账号注册表为准。

### 配置项

| 字段 | 用法 |
| --- | --- |
| `render_mode` | `auto` 或有效 visualizer ID，默认 `auto` |
| `quality` | `low / medium / high`，主要用于 Manim 路由 |
| `style_hint` | 风格提示，最多 500 字符，主要用于 Manim/视觉生成 |

### 使用技巧

1. 数据图表提供真实数据、单位、系列名称和想比较的关系。
2. 流程图说明节点、方向和分支条件，避免只写“画个图”。
3. 静态精准图解优先 SVG，结构流程优先 Mermaid，定量比较优先 Chart.js。
4. 需要学习者拖动、步进或模拟时选择 HTML，并说明交互和重置行为。
5. 不确定时先用 `auto`，让分析阶段选择。
6. `quality` 不会自动提升所有 SVG/Chart.js 的质量；它主要服务于 Manim 路径。
7. 对生成图检查标签重叠、单位、数值、图例和事实一致性。

### 示例

```bash
.venv/bin/deeptutor run visualize "画出 Transformer 编码器的数据流图" \
  --config render_mode=mermaid \
  -l zh

.venv/bin/deeptutor run visualize "用柱状图比较三种方法的准确率：A=81，B=86，C=84" \
  --config render_mode=chartjs \
  -l zh
```

## 11. `math_animator` — Manim 数学动画与分镜图

### 功能特点

阶段：

```text
concept_analysis
→ concept_design
→ code_generation
→ code_retry
→ summary
→ render_output
```

- 先分析概念和视觉设计，再生成 Manim 代码。
- 渲染失败可重试。
- 支持视频或图片输出。
- 支持自由生成和 storyboard 结构化生成路径。

### 配置项

| 字段 | 可选值 | 建议 |
| --- | --- | --- |
| `output_mode` | `video`、`image` | 先明确要动画还是分镜/静态图 |
| `quality` | `low`、`medium`、`high` | 调试先 medium/low，最终再 high |
| `generation_mode` | `freeform`、`storyboard` | 自由创作或更结构化的分镜路径 |
| `style_hint` | 最长 500 字符 | 指定配色、布局和讲解风格 |

### 依赖

- `renderer-manim` 模块 ready。
- Manim 及 Python 依赖。
- 系统 LaTeX、ffmpeg 等渲染依赖。

源码安装可使用：

```bash
python scripts/install_extras.py math-animator
```

系统依赖仍需单独安装和验证。

### 使用技巧

1. 一个视频聚焦一个核心概念，不要把整章课程塞进一个动画。
2. 给出受众、关键公式、希望出现的视觉变化和结尾结论。
3. 先低/中质量验证分镜和公式，再提高质量。
4. 只需讲解分镜时使用 `output_mode=image`，减少渲染成本。
5. 复杂公式先检查文本和 LaTeX，避免模型把符号错误带进动画。
6. 自由生成失败时实现可能回退到 storyboard；要稳定复现时应明确选择模式并保存产物信息。

### 示例

```bash
.venv/bin/deeptutor run math_animator \
  "动态展示 sin(x) 到 2sin(x+π/3) 的振幅和相位变化，面向高中生" \
  --config-json '{
    "output_mode":"video",
    "quality":"medium",
    "generation_mode":"storyboard",
    "style_hint":"深色背景，坐标轴清晰，突出相位移动"
  }' \
  -l zh
```

## 12. `mastery_path` — 大纲、学习、测评和复习闭环

### 功能特点

- 不只是讲一遍，而是维护掌握式学习路径。
- 支持学习大纲、目标、状态、测验、评分、薄弱点修复和间隔复习。
- 具有按主题类型和当前模式约束的 mastery gate。
- 可使用 RAG、原始资料阅读和 `ask_user`。

三种产品模式：

| 模式 | 主要动作 |
| --- | --- |
| `outline` | 创建和修订学习路径大纲 |
| `study` | 学习、测验、评分、修复问题 |
| `review` | 复习已学内容，可按到期提醒，也允许主动回顾 |

模式与工具权限相关：

- `mastery_build`、`mastery_revise` 属于 outline。
- `mastery_quiz`、`mastery_grade`、`mastery_assess` 等属于 study/review。
- 尚未形成大纲时，不能直接进入正式 study。

### 使用技巧

1. 首次先说明当前水平、目标、教材和可投入时间，便于建立合理大纲。
2. 在 Web 中使用完整体验最好，因为产品会显式保存和展示模式状态。
3. 先与导师确认大纲，再进入学习；不要频繁重建路径。
4. 测评时诚实作答，让错误成为后续修复和复习依据。
5. 复习不只看“到期”，也可以主动回顾已掌握内容。
6. 掌握度来自学习证据和测评，不应把模型的一句“你已掌握”当作客观能力认证。

### 示例

```text
我是大一学生，已经学过基础导数。
请帮我建立“特征值与特征向量”的掌握式学习路径。
先评估我需要哪些前置知识，再和我一起确认大纲，之后逐节学习和测评。
```

CLI：

```bash
.venv/bin/deeptutor run mastery_path \
  "带我系统掌握特征值和特征向量，先建立大纲" \
  --kb linear-algebra \
  -l zh
```

## 13. `immersive_reading` — 带证据的文档/媒体精读

### 功能特点

- 阅读材料与对话并存。
- 可列出和切换阅读标签、查看大纲、搜索和读取材料。
- 可查看 figure、跳转阅读位置、添加注释。
- 文档引用页码/章节/幻灯片位置，媒体引用时间戳。
- 可结合网页搜索、执行和独立推理工具。
- 阅读材料带 revision 和 locator，减少“引用了错误版本或位置”的风险。

### 最适合

- PDF 教材、论文、课件。
- EPUB 等文档。
- 带字幕或转写的视频/音频材料。
- 需要逐页讲解、划重点、针对当前页面提问和做注释的学习。

### 使用技巧

1. 先添加并打开材料，再提问；只说“帮我读这篇论文”但未提供材料是不够的。
2. 问题里指明当前页、章节、图表或时间段，可减少无关检索。
3. 论文可要求“先读方法，再读实验，最后比较限制”。
4. 要求引用具体页码/时间戳，并抽查原文是否支持回答。
5. 视频缺少字幕时仍可播放，但导师证据会受限，不应假装理解了未提供的音轨内容。
6. 跨大量外部资料的最新调研，Deep Research 通常更合适。

### 示例

```text
请先阅读当前论文的方法章节：
1. 用三句话概括方法；
2. 指出关键公式所在页并解释变量；
3. 给出两条作者明确写出的限制；
4. 区分作者原文和你的推断。
```

CLI 别名：

```bash
.venv/bin/deeptutor run immersive_reading "解释当前材料的第三章" -l zh
# 也可使用 reading / read 别名，材料引用需按当前 CLI 契约提供
```

## 14. `video_lesson` — Remotion 动画课程

### 功能特点

- code_generation → render_check → render_output。
- 生成 Remotion 视频课程并在浏览器播放。
- 可带 TTS 旁白；旁白不可用时可显示字幕。
- 渲染检查在受限 JavaScript 执行环境中进行。
- 取消会停止构建过程。

### 配置项

| 字段 | 可选值 | 用法 |
| --- | --- | --- |
| `generation_mode` | `freeform`、`storyboard` | 自由 Remotion 创作或更有界的结构化课程生成 |

### 依赖和成本

- 后端需要 Node.js 22+ 和 npm。
- 首次使用会下载固定版本 Remotion 包和 WebAssembly JavaScript 解释器。
- 生成视频比文本和普通图更耗时，应预留下载、生成和检查时间。

### 使用技巧

1. 明确课程对象、学习目标、核心概念和期望时长。
2. 一门短视频聚焦 1–3 个学习目标，不要直接要求“讲完整个大学课程”。
3. 给出希望出现的画面、示例和练习，而不仅是标题。
4. 无头/自动化任务优先考虑 storyboard，交互式创作可使用 freeform。
5. 在 Web 中查看最终播放、字幕和旁白效果最完整。
6. 只要一个数学过程动画时用 Math Animator，不必生成完整 Video Lesson。

### 示例

```bash
.venv/bin/deeptutor run video_lesson \
  "为高中生生成一节 5 分钟的光合作用入门动画课，包含光反应、暗反应和一道检查题" \
  --config generation_mode=storyboard \
  -l zh
```

## 15. `audio_overview` — 双人音频与文字稿

### 功能特点

阶段：

```text
retrieving → script_writing → voice_generation → publishing
```

- 从知识库检索，或读取一个非空 Co-writer 笔记。
- 生成 host/expert 双人对话脚本。
- 合成音频，同时生成 transcript。
- 返回引用、分段脚本、音频路径、文字稿路径和工作区产物。

### 输入前提

必须满足至少一个：

- 附加知识库。
- 提供非空 `note_document_id` 对应的笔记。

两者都没有时会报“需要附加知识库”类错误。使用多个知识库时，当前实现主要取第一个知识库名称用于该流程，建议明确只附加目标库。

### 配置项

| 字段 | 范围/默认 | 用法 |
| --- | --- | --- |
| `topic` | 最长 500 字符 | 概览主题；为空时使用用户消息 |
| `target_minutes` | 1–15，默认 5 | 目标时长，不保证逐秒精确 |
| `host_voice` | `null` 或 voice ID | 主持人声音；空则使用默认 |
| `expert_voice` | `null` 或 voice ID | 专家声音；空则使用默认 |
| `max_context_chunks` | 1–12，默认 6 | 检索上下文块数 |

### 使用技巧

1. 先确认知识库已完成解析和检索，embedding 配置可用。
2. 配置并试听 TTS；模块 ready 不等于语音服务一定可用。
3. 主题要具体，例如“比较第三章的两种证明”，不要只说“讲讲这本书”。
4. 先用默认 5 分钟检查脚本和引用，再生成更长版本。
5. 检索结果太泛时可增加 `max_context_chunks`，但更多上下文不等于必然更准确。
6. 自定义 voice 必须填写当前语音 provider 实际支持的 ID。
7. 发布前检查 transcript、事实、引用和双人语气，不要只检查音频文件是否生成。

### 示例

```bash
.venv/bin/deeptutor run audio_overview \
  "围绕线性代数知识库中的特征值与特征向量，生成一期入门音频概览" \
  --kb linear-algebra \
  --config-json '{
    "topic":"特征值与特征向量的直观意义和计算方法",
    "target_minutes":5,
    "max_context_chunks":8
  }' \
  -l zh
```

## 16. 容易混淆的生成类能力怎么选

| 需求 | 应该选择 | 原因 |
| --- | --- | --- |
| 一张结构图/数据图/交互页面 | `visualize` | 面向通用视觉产物和校验 |
| 数学概念动态演示 | `math_animator` | 专用 Manim 概念分析和渲染 |
| 有章节感的完整动画课 | `video_lesson` | 面向 Remotion 课程、播放和旁白 |
| 双人音频讲解 | `audio_overview` | 检索、双人脚本、TTS、文字稿 |
| 生成一张普通插画 | Chat 中的 `imagegen` Tool | 它是工具，不是独立 Capability |
| 生成一段通用视频素材 | Chat 中的 `videogen` Tool | 它是工具，不等于 Manim 或 Remotion 课程 |

简单记忆：

```text
图解：Visualize
数学动画：Math Animator
完整视频课：Video Lesson
知识库播客：Audio Overview
```

## 17. 组合使用技巧

### 17.1 教材学习闭环

```text
immersive_reading 阅读教材
  → deep_solve 解决典型题
  → deep_question 生成练习
  → mastery_path 建立路径、测评与复习
  → audio_overview 生成复盘音频
```

### 17.2 研究闭环

```text
ask_questions 澄清研究问题
  → deep_research 检索、拆解和报告
  → visualize 制作对比图或流程图
  → chat 面向不同受众改写报告
```

### 17.3 课程制作闭环

```text
deep_research / immersive_reading 整理可靠内容
  → chat 设计教学目标与分镜
  → video_lesson 生成完整课程
  或 math_animator 生成单个数学演示
  → deep_question 生成课后练习
```

组合时注意：各 Capability 共享会话上下文，但不同能力的专属配置、材料 revision、工具权限和产物仍需明确提供，不能假设上一轮的所有临时状态都会自动继承。

## 18. 成本、质量与安全技巧

1. **从轻到重**：先 Chat/quick/低质量草稿，确认方向后再 deep/high。
2. **限制范围**：主题、页码、题数、迭代数、时长越明确，返工越少。
3. **按需工具**：工具和搜索越多，延迟、费用和失败点越多。
4. **保存中间产物**：大纲、脚本、题目和分镜先审查，再生成重型媒体。
5. **检查终态**：看到文本或文件不代表 Turn 成功，仍要确认最终 result/done 和错误状态。
6. **核验证据**：搜索摘要、全文、原始页码、代码审查和实验复现是不同证据等级。
7. **关注账号权限**：可用工具和知识库还受账号、工作区和资源授权限制。
8. **控制敏感信息**：上传材料、启用外部搜索或 MCP 前，确认内容可以发送到相应服务。
9. **取消长任务**：方向错误时及时取消，而不是等待完整媒体渲染结束。
10. **关注 `cost_summary`**：它帮助观察成本，但不自动等于套餐配额或超额阻断。

## 19. 常见问题排查

| 现象 | 优先检查 |
| --- | --- |
| 模式不存在 | `module list`、`plugin list`，模块是否 installed/enabled |
| 模块存在但不可用 | ready issues、依赖组和系统依赖 |
| 配置报未知字段 | 当前 request schema；是否套用了历史示例 |
| Deep Research 无法启动 | 是否同时提供必填 `mode` 和 `depth` |
| 研究没有期望来源 | 工具是否启用、KB 是否附加、账号是否有授权 |
| 出题题型数量不一致 | `per_type_counts` 总和是否等于 `num_questions` |
| Visualize 类型不可用 | 当前账号 visualizer 注册表、render_mode 是否正确 |
| Manim 失败 | Manim、LaTeX、ffmpeg、模块 ready 和渲染日志 |
| Video Lesson 首次很慢 | 固定 npm 包和 WebAssembly 运行时的首次下载 |
| 视频没有旁白 | TTS 是否配置；不可用时检查字幕回退 |
| Audio Overview 提示缺材料 | 是否附加 KB 或提供非空 note_document_id |
| 音频无法生成 | embedding/RAG、TTS provider、voice ID、输出目录 |
| 精读没有证据 | 材料是否真正附加、revision 是否一致、字幕/文本是否存在 |
| Mastery 工具被模式拒绝 | 当前处于 outline/study/review 哪种模式，是否已有大纲 |

## 20. 源码索引

| Capability | 主要实现 |
| --- | --- |
| `chat` | `deeptutor/agents/chat/capability.py` |
| `ask_questions` | `deeptutor/capabilities/ask_questions/capability.py` |
| `deep_solve` | `deeptutor/capabilities/solve/capability.py` |
| `deep_question` | `deeptutor/agents/question/capability.py` |
| `deep_research` | `deeptutor/agents/research/capability.py` |
| `visualize` | `deeptutor/agents/visualize/capability.py`、`deeptutor/visualizers/` |
| `math_animator` | `deeptutor/agents/math_animator/capability.py` |
| `mastery_path` | `deeptutor/capabilities/mastery/` |
| `immersive_reading` | `deeptutor/capabilities/reading/` |
| `video_lesson` | `deeptutor/agents/video_lesson/capability.py` |
| `audio_overview` | `deeptutor/capabilities/audio_overview/` |

公共契约：

- `deeptutor/core/capability_protocol.py`
- `deeptutor/runtime/bootstrap/builtin_capabilities.py`
- `deeptutor/runtime/request_contracts.py`
- `deeptutor/modules/manifests/*.json`
- `deeptutor/agents/_shared/capability_result.py`

相关文档：

- `docs-for-dev/TOOLS_AND_CAPABILITIES-zh.md`
- `docs-for-dev/SCIENTIFIC_RESEARCH-zh.md`
- `docs-for-dev/SOURCE_VISUALS-zh.md`
- `docs-for-dev/READING_EXTENSIONS-zh.md`
- `docs-for-dev/PRACTICE.md`
- `docs-for-dev/项目架构与代码导读.md`
