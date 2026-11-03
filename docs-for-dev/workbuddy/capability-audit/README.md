# DeepTutor 真实能力审计（WorkBuddy / MCP）

日期：2026-11-03

本审计使用 `DEEPTUTOR_MCP_DETERMINISTIC=0`，通过官方 MCP stdio 客户端调用真实能力，而不是用占位 runner 验证协议。验收不只看 `succeeded`：必须看到本领域实际输出，且产物与请求主题一致。

## 结果总览

| 能力 | 结果 | 实际产物 / 验收证据 |
| --- | --- | --- |
| `problem_solve` | ✅ 通过 | 实际分步求解方程，含根、验证和方法说明 |
| `deep_question` | ✅ WorkBuddy 通过 | 生成完整四选一题目、选项、答案和解析 |
| `quiz_judge` | ✅ 通过 | 对学习者的具体答案给出形成性判分与反馈 |
| `immersive_reading` | ✅ 通过 | 实际 LLM 精读回答，带章节引用 |
| `visualize` | ✅ WorkBuddy 通过 | 正确的立方体体积 Mermaid，包含 `a³` 和 `3³=27` |
| `mastery_path` | ✅ 通过 | 生成 3 个学习阶段并持久化到 PostgreSQL，返回 `path_id` |
| `deep_research` | ✅ 直接 MCP 复检通过，⏳ WorkBuddy 待复验 | 新 job 基于附件知识库强制 RAG，255.3 秒返回 6,385 字完整报告，1 条引用，`partial=false` |
| `audio_overview` | ✅ WorkBuddy 通过 | 离线 macOS `say` + ffmpeg 生成真实 MP3 和逐字稿；最近一次约 50 秒、532 KB |
| `video_lesson` | ✅ 直接 MCP 复检通过，⏳ WorkBuddy 待复验 | 新 job 使用结构化分镜 + 受控 Remotion，50.3 秒完成；ZIP 为 274,627 字节，内含 718,652 字节课程 HTML，`unzip -t` 通过 |
| `math_animator` | ✅ 直接 MCP 复检通过，⏳ WorkBuddy 待复验 | 新 job 真实 Manim MP4，659.0 秒完成；79,840 字节，ffprobe 显示 5.000 秒、MP4 容器有效；中途一次 LLM 断连已由重试恢复 |

## 根因与已修复项

1. **客户端旧环境**：WorkBuddy 运行进程曾带 `DEEPTUTOR_MCP_DETERMINISTIC=1`，占位结果会被标成功。`capabilities_list` 现在返回 `execution_mode`，明确区分 `real` 与 `deterministic`。
2. **能力映射错误**：`problem_solve` 映射到 `deep_solve`；`quiz_judge` 复用真实 AI 判分实现。
3. **交互与多阶段丢失**：headless runner 处理 `ask_user`，研究任务自动确认大纲并继续完整研究。
4. **掌握路径概念误用**：`mastery_path_generate` 生成目标路径并写入 PostgreSQL。
5. **精读固定使用确定性回答器**：真实模式默认使用 LLM；降级时明确标记 `engine=llm_fallback`、`degraded=true`。
6. **产物收集缺失**：补齐可视化、音频、视频课、Manim 产物从实际 turn workspace 到对象存储的路径；优先使用 `workspace_items.relative_path`。
7. **空结果/占位结果验收**：真实 runner 拒绝 placeholder、空输出、研究大纲和媒体无产物结果。
8. **宿主路由错误**：Skill 改为 DeepTutor 负责实际学习生产，WorkBuddy 只做交互与结果呈现。
9. **大结果截断破坏 JSON 协议**：`_truncate` 保留任务状态、错误和产物结构，优先压缩次要遥测与正文，不再把整个 `data` 变成字符串。
10. **研究模型绕过 RAG**：MCP 快速研究默认一个已确认研究块；附件知识库时由 DeepTutor 强制执行 RAG 并登记引用，检索为空会失败，不允许用通用知识冒充知识库研究。
11. **视频自由 TSX 不稳定**：MCP 默认 `generation_mode=storyboard`，模型只生成教学分镜，DeepTutor 编译安全 TSX；活动 HTML 以 ZIP 交付，不绕过产物安全门。
12. **数学动画思考预算过长**：初始和重试代码生成均使用低推理强度，避免模型在内部思考上耗尽输出预算。

## 媒体产物下载验证

- 数学动画通过 `artifact_get` 获取短期链接后下载 150,611 字节，文件头包含 MP4 `ftyp`。
- 视频课通过 `artifact_get` 下载 `lesson.zip`（247,689 字节），ZIP 内包含 `lesson.html`（676,573 字节）。
- 音频已通过 ffprobe 和 WorkBuddy 端到端展示验证。

### 2026-11-03 16:10 复检

- 三项均使用新的 job id，不复用旧成功记录。
- 深度研究：255.3 秒，6,385 字，1 条正文编号引用，`partial=false`、`degraded=false`。
- 视频课：50.3 秒，下载 `lesson.zip` 274,627 字节，内含 `lesson.html` 718,652 字节，压缩包完整性测试通过。
- 数学动画：659.0 秒，下载 MP4 79,840 字节，`ffprobe` 验证为 5.000 秒 MP4。一次大模型 `incomplete chunked read` 被内置重试恢复，最终任务成功。

## 后续

- 在 WorkBuddy 中复验深度研究、视频课和数学动画，重点确认宿主没有替代生产。
- 非本地 macOS 部署需配置可替换 TTS 供应商。
- 继续验证长任务取消、幂等、额度、多账户隔离和模型失败提示。

## WorkBuddy 客户端复验

重启客户端后，实际 MCP 进程确认 `DEEPTUTOR_MCP_DETERMINISTIC=0`。WorkBuddy 先提交了一个较复杂的可视化请求，模型生成停滞后按取消处理；随后将请求收敛为一个 Mermaid mindmap，DeepTutor 用时约 41 秒返回正确的 `V=a³` 与 `3³=27`，客户端明确展示“这是 DeepTutor 的产物，不是我手画的”。证据：`workbuddy-visualize-real.png`。

随后在 WorkBuddy 中调用 `quiz_generate_submit` 生成 1 道立方体体积四选一选择题。DeepTutor 返回完整题干、A-D 选项、答案及解析，客户端明确显示“这是 DeepTutor 出的，不是我编的”。证据：`workbuddy-quiz-real.png`。

音频实测产物约 33 秒，已通过 `artifact_get` 下载并用 ffprobe 验证为有效 MP3。WorkBuddy 端到端复验另生成约 50 秒、532 KB 的 MP3 和逐字稿，客户端已展示真实短期链接。证据：`workbuddy-audio-real.png`。

本目录的 JSON 是实际调用记录，不用“工具注册成功”冒充“能力产出成功”。
