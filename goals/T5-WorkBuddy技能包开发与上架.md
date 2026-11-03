# T5 — WorkBuddy 技能包开发与上架

> Codex goal-mode target：完成本目标时，必须交付“产出物”中的文件/代码，并按“验收命令”运行测试，留下可审查证据。


## 目标

创建可在 WorkBuddy 中安装、触发、调用 DeepTutor MCP 工具并通过审核的 Skill 包。该目标独立于后端 MCP 开发：T1/T3/T4 提供工具服务，T5 负责把这些能力包装成用户可理解、可触发、可审核的 WorkBuddy 技能。

## 前置依赖

- T1 至少提供本地 stdio MCP 工具，或 T3 提供远程 HTTP MCP。
- 已冻结工具名、入参/出参、错误码和长任务轮询规则。
- 已准备测试账号、测试材料和可访问的 MCP endpoint。

## Skill 与 MCP 的边界

### Skill 负责

- 识别用户意图；
- 澄清学段、学科、材料、题目范围；
- 决定调用哪个 MCP 工具；
- 把工具结果翻译成学习者能理解的话；
- 引导用户等待长任务、继续追问或复习；
- 隐藏内部 ID、错误堆栈和服务器路径；
- 遵守 WorkBuddy 上架规范。

### MCP 负责

- 真正执行解题、研究、出题、判分、掌握度读取；
- 鉴权和 `owner_user_id` 隔离；
- 作业状态、幂等、取消；
- artifact 存储与授权 URL；
- 用量计量和审计。

**不要把复杂业务逻辑写进 Skill 脚本。** Skill 是声明式门面，不保存学习状态、不保存密钥、不直接访问服务器数据库。

### 模型调用边界

- WorkBuddy 负责意图理解、对话组织、简单讲解和普通题目生成；
- DeepTutor 负责复杂 Agent 管线、资料精读、判题、练习/掌握度/SRS 状态和教学产物；
- 普通题目由宿主生成后通过 `practice_entry_create` 入库，不再调用 `quiz_generate_submit` 重复生成；
- 只有学习状态驱动、复杂校验或多阶段生成任务才调用 DeepTutor 模型管线。

## 1. 技能包规划

首发建议一个主技能，后续再拆细分技能。

### 主技能

- `name`: `deeptutor-learning`
- 中文名：DeepTutor 全学段 AI 学习助手
- 英文名：DeepTutor AI Learning Companion

### 后续细分技能

| Skill | 面向用户 | 主要工具 |
| --- | --- | --- |
| K12 作业与错题助手 | K12 学生/家长 | problem solving、quiz、practice、mastery |
| 大学课程自学助手 | 大学生 | reading、visualize、research、practice |
| 研究生文献研读助手 | 研究生 | reading、deep research、audio overview |
| 考试冲刺复习助手 | 考研/考证/语言考试 | quiz、review tasks、mastery、reports |

首个审核包只放主技能，降低审核复杂度；细分技能等主技能验证触发率后再发布。

最终技能包、构建产物、测试脚本的目录规范见 [DIRECTORY_LAYOUT.md](./DIRECTORY_LAYOUT.md)。

## 2. 本地目录结构

在仓库中新建：

```text
workbuddy-skills/
└── deeptutor-learning/
    ├── SKILL.md
    ├── references/
    │   ├── mcp-tools.md
    │   ├── job-flow.md
    │   ├── learning-workflows.md
    │   ├── output-style.md
    │   ├── safety-and-boundaries.md
    │   └── troubleshooting.md
    ├── templates/
    │   ├── study-plan-template.md
    │   ├── quiz-summary-template.md
    │   └── mastery-report-template.md
    └── examples/
        ├── solve-problem.md
        ├── reading-session.md
        ├── quiz-practice.md
        └── media-generation.md
```

说明：

- 首发生产版本**不放 scripts**，避免 WorkBuddy 安全扫描误判任意命令执行。
- T0 Spike 中用于验证 CLI 的脚本只能留在内部目录，不进入上架包。
- `references/` 放工具契约、轮询规则、输出格式和边界；主 `SKILL.md` 保持短而清晰。
- `examples/` 用于人工测试，不一定随包发布；是否发布以上架包大小限制为准。

## 3. 创建 SKILL.md

创建 `workbuddy-skills/deeptutor-learning/SKILL.md`：

```markdown
---
name: deeptutor-learning
display_name: DeepTutor 全学段 AI 学习助手
display_name_en: DeepTutor AI Learning Companion
description: 面向 K12、大学、研究生与终身学习者的解题、精读、出题、错题、掌握度、复习、研究和音视频讲解助手
description_zh: 陪你完成作业答疑、教材论文精读、分层练习、错题复盘、掌握度追踪、间隔复习、研究入门和难点多媒体讲解
description_en: An AI learning companion for solving problems, reading materials, practice, mistake review, mastery tracking, spaced repetition, research and media explanations.
version: 0.1.0
author: <your-org>
examples_zh:
  - "一步步讲懂这道题，再给我两道同类练习"
  - "根据这份课件出 8 道诊断题，提交后告诉我薄弱知识点"
  - "陪我逐段读这篇论文，整理概念和复习问题"
  - "把这个数学概念做成动画或短视频讲解"
examples_en:
  - "Explain this problem step by step and give me two similar practice questions"
  - "Create eight diagnostic questions from these slides and track my weak points"
  - "Read this paper with me section by section and create review questions"
---

# DeepTutor 全学段 AI 学习助手

当用户需要解题、教材/论文精读、练习出题、提交答案、错题复盘、掌握度查询、间隔复习、研究入门或教学媒体讲解时使用本技能。

## 工作原则

1. 先确认学段、学科、目标、材料和练习范围；材料不足时追问，不自行编造。
2. 对 K12 用户优先启发式讲解，不直接鼓励抄答案。
3. 长任务必须调用提交工具获得 job id，再轮询状态；不要假装任务已经完成。
4. 不向用户展示内部 ID、服务器路径、堆栈或密钥。
5. 输出学习建议和形成性反馈，不承诺提分，不代表学校成绩或官方认证。

@references/mcp-tools.md
@references/job-flow.md
@references/learning-workflows.md
@references/output-style.md
@references/safety-and-boundaries.md
@references/troubleshooting.md
```

> 注意：`@references/...` 是否由宿主自动展开以 WorkBuddy 开放平台当前文档为准；若不支持自动展开，则在正文中写成“需要时阅读 references 下对应文件”的操作规则，并通过 `read_skill`/宿主支持的方式加载。

## 4. MCP 配置（不放密钥）

### 本地 stdio 调试

用户或测试者的 `~/.workbuddy/mcp.json`：

```json
{
  "mcpServers": {
    "deeptutor": {
      "type": "stdio",
      "command": "/abs/path/to/.venv/bin/python",
      "args": ["-m", "deeptutor_cli.main", "mcp", "serve", "--transport", "stdio"],
      "env": {
        "DEEPTUTOR_HOME": "/abs/path/to/runtime-home",
        "DATABASE_URL": "postgresql+asyncpg://deeptutor:deeptutor@localhost:5432/deeptutor",
        "S3_ENDPOINT": "http://localhost:9000",
        "S3_BUCKET": "deeptutor-dev",
        "S3_ACCESS_KEY_ID": "${DEEPTUTOR_S3_KEY}",
        "S3_SECRET_ACCESS_KEY": "${DEEPTUTOR_S3_SECRET}"
      }
    }
  }
}
```

### 远程 HTTP 试用

```json
{
  "mcpServers": {
    "deeptutor": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${DEEPTUTOR_TOKEN}"
      }
    }
  }
}
```

要求：

- 文档只展示 `${...}` 占位，不写真实 token；
- 真实密钥通过 WorkBuddy 环境变量、用户本地配置或授权流程提供；
- 上架包中不得包含生产 token。

## 5. references 文件内容

### `references/mcp-tools.md`

列出工具和选择规则：

| 用户意图 | 调用工具 |
| --- | --- |
| 看支持哪些能力/依赖是否就绪 | `capabilities_list` |
| 解题、研究、可视化、音频、视频、动画 | `capability_run_submit` + `capability_job_get` |
| 取消长任务 | `capability_job_cancel` |
| 任务中途需要用户补充材料/答案 | `capability_job_reply` |
| 获取生成的报告、图片、音视频 | `artifact_get` |
| 今日复习、错题、掌握度 | `practice_*`、`mastery_*`、`review_tasks_list` |

每个工具写清：

- 何时调用；
- 必填参数；
- 示例；
- 权限要求；
- 结果字段如何解释；
- 不允许传给模型的字段。

### `references/job-flow.md`

固定长任务流程：

```text
1. capability_run_submit(input, idempotency_key?)
2. 收到 job_id/status
3. capability_job_get(job_id)
   - queued/running：提示正在处理，按服务建议间隔重试
   - needs_input：向用户澄清，再 capability_job_reply
   - succeeded：读取 result/artifacts
   - failed：展示用户可理解错误和重试建议
   - canceled：说明任务已取消
```

要求：

- 不无限轮询；
- 不编造 artifact URL；
- 不把内部错误堆栈原样给用户；
- 幂等键对同一用户请求保持稳定。

### `references/learning-workflows.md`

写 6 条核心流程：

1. 解题：澄清题目 → problem solve job → 分步解释 → 同类练习 → 加入错题/复习。
2. 精读：确认材料/章节 → reading session → 段落解释/引用 → 复习题。
3. 出题：确认范围/题型/数量 → quiz job → 用户作答 → judge/check → 错因与复习。
4. 今日复习：summary → queue → get/check/review → 小结。
5. 掌握度：paths/map/objective → 解释薄弱点 → 推荐下一步。
6. 教学媒体：检查 capability ready → 告知耗时/成本 → submit job → 轮询 → artifact 链接。

### `references/output-style.md`

规定输出：

- 使用中文；
- 对 K12 先引导再给答案；
- 数学题展示关键步骤；
- 引用资料时保留章节/页码/时间戳；
- 末尾给出“下一步做什么”；
- 不展示内部 ID；
- 不输出无法验证的考试结论。

### `references/safety-and-boundaries.md`

必须写：

- 不提供作弊保证；
- 不替代教师/学校/官方考试评分；
- 不承诺提分；
- 不要求用户输入服务器路径；
- 不读取 WorkBuddy 未授权文件；
- 不绕过 MCP 直接执行系统命令；
- 涉未成年人内容要更保守。

### `references/troubleshooting.md`

覆盖：

- 未登录/401；
- MCP 连接失败；
- capability missing dependency；
- quota exceeded；
- job failed/canceled/needs_input；
- artifact URL 过期；
- 上传材料解析失败。

## 6. 创建最小可测试技能包

执行步骤：

```bash
mkdir -p workbuddy-skills/deeptutor-learning/{references,templates,examples}
cat > workbuddy-skills/deeptutor-learning/SKILL.md
# 按上文模板填写
# 补齐 references 六个文件
```

检查：

```bash
python - <<'PY'
from pathlib import Path
import yaml
p=Path('workbuddy-skills/deeptutor-learning/SKILL.md')
text=p.read_text()
assert text.startswith('---\n')
fm=text.split('---',2)[1]
data=yaml.safe_load(fm)
required=['name','display_name','display_name_en','description','description_zh','description_en','version','author']
missing=[k for k in required if not data.get(k)]
assert not missing, missing
print('frontmatter ok:', data['name'], data['version'])
PY
```

如果环境没有 PyYAML，可先使用仓库现有 Python 环境，或将该校验做成脚本。

## 7. 本地测试流程

### 7.1 MCP 服务自检

- [x] Docker Compose 启动 Postgres/MinIO。
- [x] `deeptutor mcp serve --transport stdio` 能启动。
- [x] MCP Inspector 或等价客户端能 list tools。
- [x] `capabilities_list` 返回 expected tools。
- [x] 研究/可视化 job 可提交并轮询成功。
- [x] artifact 可获取。

### 7.2 WorkBuddy 配置测试

- [x] WorkBuddy 能发现 `deeptutor` MCP server。
- [x] 连接指示灯正常。
- [x] `/deeptutor-learning` 能打开 Skill（`skill-trigger-e2e.png`）。
- [x] “出 5 道题/今天复习什么”命中正确工具；简单讲解由宿主模型按分工完成。
- [x] 未登录时能出现登录/授权引导（T3 HTTP 401 证据）。

### 7.3 场景测试

至少跑 4 条端到端脚本：

1. K12 数学题：讲解 + 同类题；
2. 大学 PDF：精读 + 复习题；
3. 练习：提交答案 + 错因 + 掌握度变化；
4. 媒体：可视化/音频/视频 job + artifact 链接。

每条脚本记录：

- 用户话术；
- 命中 Skill；
- MCP 请求；
- 工具返回；
- 最终回复；
- 耗时和成本；
- 失败/恢复方式。

## 8. 上架材料

准备：

- Skill zip 包；
- 图标和展示图；
- 中文/英文简介；
- 3–6 个示例 prompt；
- 隐私政策；
- 用户协议；
- 数据收集说明；
- 未成年人保护说明；
- MCP 服务依赖说明；
- 401/授权/解绑说明；
- 联系方式和支持邮箱。

## 9. 上架前硬性检查

- [x] frontmatter 必填字段完整。
- [x] 无硬编码 token、密码、cookie、私钥。
- [x] 无生产服务器绝对路径。
- [x] 无 `curl` 外传数据、无任意 shell、无 `rm -rf` 等危险脚本。
- [x] 不把 `exec` 暴露给宿主模型。
- [x] 所有长任务走 job，不假装同步完成。
- [x] 输出不承诺提分、官方成绩或证书。
- [x] 不包含未授权教材、真题、机构讲义。
- [x] references 中工具名与 T2/T3 实际实现一致。
- [x] 在干净环境按 README 完成安装和联调（全新 venv + 独立技能目录，场景 09：39 个工具、pip check、Skill validator 均通过）。

## 完成标准

- [x] `workbuddy-skills/deeptutor-learning/` 成为完整可审查技能包（SKILL.md + 6 篇 references + 3 模板 + 4 示例，纯声明式无脚本）。
- [x] Skill 能通过本地 WorkBuddy 调通 MCP（stdio 与 streamable HTTP 两种配置，官方 MCP 客户端 `initialize`/`list_tools` 成功；桌面端 `39/39` 工具启用截图见 `docs-for-dev/workbuddy/mcp-connection.png`）。
- [x] 至少 4 条学习场景端到端测试通过（K12 数学、大学精读、练习闭环、媒体生成；`scripts/workbuddy/e2e/run.py` 两种传输各跑一遍，共 8 条记录）。
- [x] 技能包通过静态 frontmatter 校验和敏感信息扫描（validator PASS + `tests/workbuddy_skills` 8 项）。
- [x] 上架材料齐全（图标、展示图、中/英简介、隐私政策、用户协议、未成年人保护、依赖、授权解绑、支持信息）。
- [x] 提交 WorkBuddy 开放平台审核，或进入内部审核队列（内部审核包与材料齐备；占位域名/邮箱待运营替换后提交）。


## 2026-11-03 补充验收

- 真实模型内容验证已完成：stdio 与 streamable HTTP 两条链路均用真实模型产出完整选择题（非占位），记录见 `docs-for-dev/workbuddy/e2e/05-real-llm-quiz-{stdio,http}.json`。
- WorkBuddy 桌面端已实际接入，MCP 服务管理显示 `39/39` 工具启用，截图：`docs-for-dev/workbuddy/mcp-connection.png`。
- 宿主生成内容的学习闭环已验证：`docs-for-dev/workbuddy/e2e/06-host-driven-practice-stdio.json` 证明宿主提供题目后，DeepTutor 无需再次生成即可完成入库、判题、SRS 和统计。
- WorkBuddy 客户端完整验收已完成：Skill 首次安装并启用，`/deeptutor-learning` 显式触发成功；“今日复习”完整对话和“宿主生成 5 题 → `practice_entry_create` 入库”均有截图及 JSON 记录（场景 07/08）。
- 尚待外部条件：平台正式提交、支持邮箱/域名占位替换；干净环境安装复核见下方验证记录。

## 验证证据（2026-11-03）

```text
python scripts/release/validate_workbuddy_skill.py workbuddy-skills/deeptutor-learning
=> PASS（0 errors）

python scripts/release/build_workbuddy_skill_zip.py workbuddy-skills/deeptutor-learning dist/workbuddy-skills
=> dist/workbuddy-skills/deeptutor-learning-0.1.0.zip（validated，含 manifest/sha256）

python -m pytest tests/workbuddy_skills -q
=> 8 passed

python scripts/workbuddy/e2e/run.py
=> 01-k12-math / 02-reading-session / 03-practice-loop / 04-media-generation
   stdio + http 全部通过（记录：docs-for-dev/workbuddy/e2e/*.json）

python -m scripts.workbuddy.e2e.host_driven_practice
=> 06-host-driven-practice stdio 通过；宿主供题，无 DeepTutor 服务端生成调用

真实 WorkBuddy 客户端
=> 07-workbuddy-desktop-review / 08-workbuddy-skill-host-generated-practice
   WorkBuddy 5.9.2 真实客户端证据；宿主生成 5 题并由 MCP 写库

独立干净环境（全新 venv + 独立技能目录）
=> 09-clean-environment-stdio：pip check / validator / 39 tools / practice_summary_get 全通过

联调与安全扫描报告：docs-for-dev/workbuddy/local-validation.md
```

## Codex 实施任务

1. 创建 `workbuddy-skills/deeptutor-learning/` 完整技能包。
2. 编写符合 WorkBuddy 要求的 `SKILL.md` frontmatter 和正文。
3. 编写全部 references、templates、examples。
4. 提供 frontmatter 校验、敏感信息扫描和 zip 打包脚本。
5. 使用本地 stdio 与远程 HTTP 两种 MCP 配置分别联调。
6. 跑通至少四条 WorkBuddy 端到端学习场景。
7. 准备上架 zip、图标、隐私政策、用户协议、未成年人说明和支持信息。

## 验收命令/证据

```bash
python scripts/release/validate_workbuddy_skill.py workbuddy-skills/deeptutor-learning
python scripts/release/build_workbuddy_skill_zip.py workbuddy-skills/deeptutor-learning dist/workbuddy-skills
python -m pytest tests/workbuddy_skills -q
python -m scripts.workbuddy.e2e.host_driven_practice
```

必须保留 WorkBuddy 连接指示灯截图、工具调用日志、四条 E2E 记录、安全扫描报告和待提交 zip 路径。

## 非目标

- Skill 不实现自己的题库、RAG、掌握度数据库。
- Skill 不保存用户学习记录。
- Skill 不直接连接 Postgres/对象存储。
- Skill 不绕过 DeepTutor MCP 调内部服务。
- Skill 不做完整教师端/班级管理后台。
