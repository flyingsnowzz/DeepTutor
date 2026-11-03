# DeepTutor 真实能力审计（WorkBuddy / MCP）

日期：2026-11-03

本审计使用 `DEEPTUTOR_MCP_DETERMINISTIC=0`，直接通过官方 MCP stdio 客户端调用真实能力，而不是用占位 runner 验证协议。验收不只看 `succeeded`：必须看到本领域实际输出，且产物与请求主题一致。

## 结果总览

| 能力 | 结果 | 实际产物/阻塞原因 |
| --- | --- | --- |
| `problem_solve` | ✅ 通过 | 实际分步求解方程，含根、验证和方法说明 |
| `deep_question` | ✅ 通过 | 生成完整四选一题目、选项、答案和解析 |
| `quiz_judge` | ✅ 通过 | 对学习者的具体答案给出形成性判分与反馈 |
| `immersive_reading` | ✅ 通过 | 实际 LLM 精读回答，带章节引用 |
| `visualize` | ✅ 通过 | 正确的立方体体积 Mermaid，包含 `a³` 和 `3³=27` |
| `mastery_path` | ✅ 通过 | 生成 3 个学习阶段并持久化到 PostgreSQL，返回 `path_id` |
| `deep_research` | ⚠️ 部分通过 | 已越过研究大纲，但完整检索/报告超过 15 分钟；当前模型长上下文与检索稳定性仍需优化 |
| `audio_overview` | ✅ 通过 | 使用离线 macOS `say` + ffmpeg 生成真实 MP3 和逐字稿；MCP 产物下载验证通过 |
| `video_lesson` | ❌ 阻塞 | 代码生成阶段超过 15 分钟，未通过收敛/渲染验收，不能用宿主视频替代成功 |
| `math_animator` | ❌ 阻塞 | 代码生成多次达到输出上限并重试，未得到合格渲染产物 |

## 根因与已修复项

1. **客户端旧环境**：WorkBuddy 运行进程仍带 `DEEPTUTOR_MCP_DETERMINISTIC=1`，所以占位结果被标成功。`capabilities_list` 现在返回 `execution_mode`，明确区分 `real` 与 `deterministic`。
2. **能力映射错误**：`problem_solve` 现映射到 `deep_solve`；`quiz_judge` 直接复用真实 AI 判分实现。
3. **交互与多阶段丢失**：headless runner 现在处理 `ask_user`，研究大纲自动确认后继续完整研究，不再把大纲/开场白当最终成果。
4. **掌握路径概念误用**：`mastery_path_generate` 改为 LLM 生成目标路径并写入 PostgreSQL，不再把交互式学习陪伴的开场白当路径产物。
5. **精读固定使用确定性回答器**：真实模式默认使用 LLM，返回 `engine=llm`；降级时明确标记 `engine=llm_fallback`、`degraded=true`。
6. **产物收集缺失**：补齐可视化、音频、HTML 视频课、Manim 产物从实际 turn workspace 到对象存储的路径；优先使用 `workspace_items.relative_path`，避免 workspace 切换后找不到文件。
7. **空结果/占位结果验收**：真实 runner 现在拒绝 placeholder、空输出、研究大纲和媒体无产物结果。
8. **宿主路由错误**：Skill 已改为 DeepTutor 负责实际学习生产，WorkBuddy 只做交互与结果呈现，不再默认由宿主出题/画图代替。

## 后续必须继续处理

- 音频：本地离线 TTS 已通过；其他部署环境仍需配置各自可用的 TTS 供应商。
- 视频/动画：选择适合长代码生成的模型并限制重试/输出预算，接受标准分别是实际 HTML 视频课和 Manim MP4。
- 研究：减少长上下文膨胀，控制单轮检索范围；接受标准是完整研究报告而不是大纲或中途取消。

## WorkBuddy 客户端复验

重启客户端后，实际 MCP 进程确认 `DEEPTUTOR_MCP_DETERMINISTIC=0`。WorkBuddy 先提交了一个较复杂的可视化请求，模型生成停滞后按取消处理；随后将请求收敛为一个 Mermaid mindmap，DeepTutor 用时约 41 秒返回正确的 `V=a³` 与 `3³=27`，客户端明确展示“这是 DeepTutor 的产物，不是我手画的”。

证据：`workbuddy-visualize-real.png`。这既证明真实链路可用，也说明请求复杂度和模型稳定性必须纳入生产验收，不能把取消或宿主兜底算作成功。

随后又在 WorkBuddy 中调用 `quiz_generate_submit` 生成 1 道立方体体积四选一题。DeepTutor 用时约 3 分钟返回完整题干、A-D 选项、正确答案 D（216）及解析，客户端明确显示“这是 DeepTutor 出的，不是我编的”。证据：`workbuddy-quiz-real.png`。

音频实测产物约 33 秒，已通过 `artifact_get` 下载并用 ffprobe 验证为有效 MP3。

本目录的 JSON 是实际调用记录，不用“工具注册成功”冒充“能力产出成功”。
