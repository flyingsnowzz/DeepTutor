# T3 — 教学媒体与 WorkBuddy 上架

## 目标

在云端多账户服务稳定后，补齐 DeepTutor 作为全学段 AI 学习平台的核心教学能力，并以合规 Skill 形式接入 WorkBuddy 等外部宿主生态。

## 前置依赖

- T2 云端多账户 HTTP 服务可试用。
- 账户隔离、额度、artifact、审计已通过验收。

## 范围

### 1. 解题能力

开放：

- `problem_solve_submit`
- `problem_solve_job_get`

能力映射：`deep_solve`。

要求：

- 支持文本题目；
- 图片题在依赖就绪后开放；
- 分步讲解；
- 不直接诱导抄答案；
- 可生成同类练习；
- 对 K12 用户使用更强调引导和学习过程的提示策略。

### 2. 精读能力

开放：

- `reading_session_start`
- `reading_session_reply`

能力映射：`immersive_reading`。

要求：

- 支持教材、PDF、论文、课件；
- 输出页码、章节或时间戳引用；
- 支持逐段总结、提问、复习题；
- 长任务与实时会话边界清楚。

### 3. 出题与主观题批改

完善：

- `quiz_generate_*`
- `quiz_judge_submit/get`

要求：

- 客观题即时反馈；
- 主观题/图片题走异步 judge；
- 输出错因、知识点、建议复习内容；
- 判分结果标注为形成性反馈，不是官方评分。

### 4. 音频微课

开放：

- `audio_overview_generate_submit/get`

能力映射：`audio_overview`。

要求：

- 输入材料或知识点；
- 生成讲稿、音频和逐字稿；
- TTS 依赖可用性检查；
- 成本和耗时在提交前提示。

### 5. 视频课与数学动画

开放：

- `lesson_video_generate_submit/get`
- `math_animation_generate_submit/get`

能力映射：

- `video_lesson`
- `math_animator`

依赖：

- Node.js/npm；
- Remotion；
- Manim；
- LaTeX；
- ffmpeg。

要求：

- `capabilities_list` 正确显示 ready/missing dependencies；
- 渲染任务可取消；
- 产物走对象存储；
- 超时和失败可解释；
- 不把本地路径返回给宿主。

### 6. WorkBuddy Skill 包

至少准备：

- 主 Skill：DeepTutor 全学段 AI 学习助手；
- 可选细分 Skill：
  - K12 作业与错题助手；
  - 大学课程自学助手；
  - 研究生文献研读助手；
  - 考试冲刺复习助手。

包含：

- WorkBuddy 要求的 frontmatter；
- 触发词；
- 中英文描述；
- 示例；
- 错误处理；
- 401 登录引导；
- 长任务等待说明；
- 学习辅助/非官方认证声明。

### 7. 安全扫描与发布材料

- 无硬编码密钥；
- 无任意命令；
- 无任意路径读取；
- 无数据外传指令；
- 权限最小化；
- 隐私政策；
- 用户协议；
- 未成年人适用策略（如面向 K12）；
- 数据删除与导出说明；
- WorkBuddy 安全扫描材料。

### 8. 可观测与运营

- 按能力统计成功率、耗时、失败原因；
- 模型成本；
- artifact 存储成本；
- 转化率；
- 用户留存和复习完成率；
- 宿主来源渠道标记。

## 产出物

- 解题/精读/判分/音频/视频/动画 MCP 工具
- 依赖就绪检测
- WorkBuddy Skill 包
- 上架说明与审核材料
- 媒体任务监控面板或报表
- 端到端演示账号与演示脚本

## 完成标准

- [ ] 学生可通过 WorkBuddy Skill 完成一次“解题 → 同类练习 → 错题复习”。
- [ ] 学生可完成一次“资料精读 → 复习题 → 掌握度更新”。
- [ ] 至少一个音频或视频教学能力可从提交走到 artifact URL。
- [ ] Manim/Remotion 依赖缺失时 `capabilities_list` 明确提示不可用。
- [ ] 长任务不会阻塞 MCP 调用。
- [ ] Skill 通过 WorkBuddy 静态规范和安全扫描。
- [ ] 文案不承诺提分、官方成绩或认证。
- [ ] 所有产物按账户授权访问。
- [ ] 成本、耗时和失败率可追踪。

## 非目标

- 不做完整学校 LMS。
- 不做监考或正式考试。
- 不做企业组织租户。
- 不保证所有第三方宿主的 MCP 超时行为一致。

