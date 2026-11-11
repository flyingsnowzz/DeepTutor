# web-vue3 相对 web（Next.js）功能差距与迁移计划

> 证据来源：当前 worktree 源码逐项核对（2026-11-10）。
> 旧版前端目录 `web/`（Next.js + React），新版目录 `web-vue3/`（Vue 3 + Vite）。
> 后端 API 两端共用（`deeptutor/api/routers/`），迁移均为前端工作，契约已存在。

## 一、设置 —— 大模型部分（优先）

旧版模型设置由 9 个组件构成（`web/components/settings/`，共约 3600 行）：
`ProvidersWorkspace`(438) / `ModelsWorkspace`(1009) / `ConnectionsEditor`(762) /
`AddProviderPanel`(228) / `ProviderModelDiscovery`(253) / `TaskModelsWorkspace`(285) /
`ModelCards`(473) / `ModelCapabilityFields`(138) / `ModelTestPanel` + `ServicePreviewPanel` +
`VoicePreviewPanel` + `VoiceDiscoveryField` + `VoiceModelFields` + `CodexOAuthCard` +
`CodeBuddyAuthCard` + `SettingsPresetsPanel` + `RegistryControls` + `ModulesPanel` +
`SettingsReadinessPanel`。

Vue3 对应实现只有 `ModelCatalogSettings.vue`(264 行) + `ModelTestPanel.vue`(62 行) +
`SubagentSettings.vue`(108 行)；`EngineConfigForm.vue` 仅 14 行通用 JSON 表单。

| # | 功能点 | 旧版 web | web-vue3 现状 | 后端契约 | 优先级 |
|---|--------|----------|--------------|----------|--------|
| M1 | 模型级字段编辑：`context_window`（含 source=manual/default、清除检测值）、`reasoning_effort`（含 codex_supported_reasoning_levels） | ModelsWorkspace L840-920 | ❌ 只能编辑 profile 级 name/provider/binding/base_url/api_key，模型只能加/删 ID |  ✅ 已迁移（ModelFieldsEditor.vue，2026-11-10） | P0 |
| M2 | 模型能力三态覆盖 `capabilities.{tools,vision,json_output,reasoning}`（auto/支持/不支持），Auto 值来自 `POST /api/settings/model-capabilities` | ModelCapabilityFields.tsx | ❌ 无 |  ✅ 已迁移（ModelFieldsEditor.vue，2026-11-10） | P0 |
| M3 | embedding 模型字段：`dimension`、`supported_dimensions`、`send_dimensions`(auto/开/关) | ModelsWorkspace RegistryField | ❌ 无（测试面板可"采用检测值"但无手动编辑） |  ✅ 已迁移（ModelFieldsEditor.vue，2026-11-10） | P0 |
| M4 | TTS 字段：`voice`、`response_format`、声音预览（VoicePreviewPanel）、VoiceDiscoveryField | VoiceModelFields/VoicePreviewPanel | ❌ 无预览、无字段 |  ✅ 已完成（TTS 标量字段 + 声音预览 + 实时音色发现三件套，TTS 标量字段已有；声音预览已迁移（voicePreview.ts + VoicePreviewPanel.vue，POST /voice/preview 返回音频 blob、超时 5–600s 钳制、防御性错误解析、自动播放/取消，接入 tts 分区，6 单测，2026-11-10）；VoiceDiscoveryField 已迁移（voiceDiscovery.ts + VoiceDiscoveryField.vue，POST /voice/voices 实时音色发现：连接指纹四层结构忠实移植 modelTestFingerprint/modelProvider，改音色不重取、改凭据/模型才重取，250ms 防抖+30s 超时+AbortController，八态状态机/下拉选择/未列出当前音色提示/手动 ID，接入 TTS 分区并从标量字段移除 voice 避免重复，14 单测，2026-11-10） | P1 |
| M5 | STT 字段：`language` | ModelsWorkspace fields | ❌ 无 |  ✅ 已迁移 | P1 |
| M6 | imagegen 字段：`size`/`quality`/`style`/`response_format` | ModelsWorkspace fields | ❌ 无 |  ✅ 已迁移 | P1 |
| M7 | videogen 字段：`aspect_ratio`/`duration`/`resolution` | ModelsWorkspace fields | ❌ 无 |  ✅ 已迁移 | P1 |
| M8 | 托管提供方锁定（`managed_by`/`read_only`，managed 时仅可改名→user_name、选 reasoning effort） | ModelsWorkspace L541-581 | ❌ 无 managed 概念，存在误改 OAuth 托管配置风险 |  ✅ 已迁移（ModelFieldsEditor.vue，2026-11-10） | P0 |
| M9 | 提供方 OAuth 卡片：OpenAI Codex OAuth（start/status/complete/cancel/logout + models/refresh + reasoning-effort）、CodeBuddy Auth | CodexOAuthCard/CodeBuddyAuthCard | ❌ 无 |  ✅ 已迁移（CodexOAuthCard/CodeBuddyAuthCard + providerAuth.ts，含轮询/远程SSH指引/回调恢复/推理强度，2026-11-10） | P1 |
| M10 | 提供方模型自动发现（ProviderModelDiscovery，拉取远端模型列表） | ProviderModelDiscovery.tsx | ❌ 无（只能手输模型 ID） |  ✅ 已迁移（ProviderModelDiscovery.vue，对接 /test-provider） | P1 |
| M11 | 服务预览面板（search/stt/imagegen/videogen 的示例请求预览 ServicePreviewPanel） | ServicePreviewPanel.tsx | ❌ 只有通用 ModelTestPanel |  已迁移：servicePreview.ts + ServicePreviewPanel.vue（POST /services/{service}/preview NDJSON 流，search/stt/imagegen/videogen 四服务，输入校验、音频8MB、媒体 objectURL、超时/中止/终态，接入 ModelCatalogSettings，8 单测，2026-11-10） | P2 |
| M12 | 设置预设（SettingsPresetsPanel，`/api/settings/presets`、`/presets/{id}/draft`） | SettingsPresetsPanel.tsx | ❌ 无 |  已迁移：SettingsPresetsPanel.vue + settingsPresets.ts（GET /presets 列表、POST /presets/{id}/draft 载入草稿，4 预设中文映射/成本/凭据/前置/能力，接入设置页「配置起点」，5 单测，2026-11-10） | P2 |
| M13 | 就绪诊断面板（SettingsReadinessPanel，`/api/settings/readiness`） | SettingsReadinessPanel.tsx |  ✅ 已完成：readiness 快照/模块/内存/分组/跳转原有；snapshot.notices severity 渲染（readinessNotices.ts）；新增 settingsReadiness.ts 对齐旧版分组语义（声明顺序 + 未知 section 保留）、required 阻断/misconfigured 警告/optional idle 不报警的 prominence 规则，以及 catalog/parser/tool/video/runtime 全部设置跳转映射；StatusSettings 改为复用该内核，测试覆盖，2026-11-11 | P2 |
| M14 | 模型重命名（user_name 展示名）与 model ID 分离编辑 | RegistryModelIdField | ❌ 列表只显示 name/model，无改名入口 |  ✅ 已迁移（ModelFieldsEditor 身份字段：显示名/模型ID，managed 时写 user_name，2026-11-10） | P1 |
| M15 | 草稿/放弃/应用工具栏 | SettingsStore 统一草稿 | ✅ 已有（draft/apply/service 流程，含测试） | 相同 | 完成 |
| M16 | 连接测试 SSE 流 + 采用检测值（context/dimension） | ModelTestPanel | ✅ 已有且对等（ModelTestPanel.vue） | 相同 | 完成 |
| M17 | 后台任务模型全局+按 kind 覆盖 | TaskModelsWorkspace | ✅ 已有（task-models 分支 + task_kinds） | 相同 | 完成 |
| M18 | Subagent CLI 配置（Claude Code/Codex/Grok/...10 种） | agent-* 分区 |  ✅ 已完成：经核对 SubagentSettings 已覆盖 SubagentBackendConfig 全部字段（enabled/model/effort/system_prompt/permission/sandbox/approval/network/ephemeral/auto_approve/thinking/forward_images/extra_args/hermes_remote 网关四件套），无字段缺失；SettingsPage 按 11 种 agent section 映射到统一编辑器并保留 family 导航；新增 consult_budget 咨询轮数预算（subagentBudget.ts 钳制 1–12 + SubagentBudgetStepper，接入 AnswerPreferencesMenu 与 start_turn 的 subagent_consult_budget），7 单测，2026-11-10 | P1 |

## 二、设置 —— 其他分区

旧版导航（settings-nav.ts）共 ~35 个叶子。Vue3 SettingsPage 分组覆盖大部分 key，
但以下旧版独立 section 在 Vue3 缺失或被合并：

| # | 功能点 | 状态 | 优先级 |
|---|--------|------|--------|
| S1 | 附件限制分区（AttachmentsSettingsSection：MB/字符预算） |  ✅ 已完成：SettingsPage attachments 分区读取 `/api/settings/chat-attachments` 的 settings/effective/bounds；四项预算使用后端范围钳制，并显示运行时 WS/文件/消息上限与“提高上传上限需重启”提示（settingsExtensions.ts，2 单测，2026-11-11） | P2 |
| S2 | 起始建议 StartersSettingsSection（chat-starters） |  ✅ 已完成：SettingsPage 对话分区接入 `/api/settings/chat-starters` settings/bounds，近期活动条数按后端范围钳制并沿用全局草稿/应用流程，2026-11-11 | P2 |
| S3 | 归档对话 ArchivedChatsSettingsSection |  已迁移：sessionArchive.ts（chat/mastery/reading 分桶、父会话归档子线程跳过、按时间排序）+ ArchivedChatsSettings.vue（all_workspaces 列表、搜索/类型筛选、取消归档 PATCH organization、删除、批量删除，接入设置页，6 单测，2026-11-10） | P2 |
| S4 | 设置引导 Tour（SettingsTourOverlay） |  ✅ 已完成：settingsTour.ts + SettingsTourOverlay.vue 迁移 7 步跨路由引导（状态→外观→网络→模型→知识库→对话→记忆），支持目标元素等待/滚动测量、自动跨页、遮罩高亮、上一步/下一步/完成/跳过、←/→/Enter/Esc 键盘操作；常规设置增加“运行设置引导”入口，Overlay 按步骤更新 launcher 路由，纯逻辑与组件测试覆盖，2026-11-11 | P3 |
| S5 | 主题预览卡 ThemePreviewCard |  ✅ 已完成并修正实际主题生效链路：AppearanceSettings 四套 SVG 预览与琉璃渐变已对齐旧版；新增 theme.ts 统一 light/snow/dark/glass document class、系统偏好与 localStorage 持久化，应用启动恢复主题，应用 UI 设置后即时切换；补齐四套 CSS token/glass 背景与暗色 folder token；chat 中 setup_applied 会重新读取 `/api/settings/ui` 并同步主题，theme/setupSync 测试覆盖，2026-11-11 | P3 |

## 三、对话（设置完成后的使用链路）

旧版 `web/features/chat` + `web/components/chat` 合计 **34,410 行**，分层为
transport(socket/TurnRuntimeClient/UnifiedTurnClient) / ChatRuntimeProvider /
ChatStateAdapter / messages / selectors / controllers / trace。
Vue3 为单文件 `ChatPage.vue`(1454 行) + 12 个小组件（合计约 2,354 行）。

已具备（证据）：`/ws` WebSocket 2.0 协议、能力选择器（deep_solve/ask_questions/
deep_question/deep_research/visualize/video_lesson/audio_overview/math_animator）、
mastery 提交流、分支选择 branch-selection、消息删除、回复语言、会话组织/删除、
TTS 播放按钮、用量页脚、Turn 导航、资源/技能/伙伴菜单。

| # | 功能点 | 旧版位置 | Vue3 状态 | 优先级 |
|---|--------|----------|-----------|--------|
| C1 | 传输层健壮性：自动重连策略 reconnect-policy、空闲恢复 chat-idle-recovery、TurnRuntimeClient 事件全覆盖 | transport/ |  ✅ 已迁移（chatTransport.ts + ChatPage 重连策略/空闲看门狗/resume_from，13 单测，2026-11-10） | P1 |
| C2 | 附件处理流水线（selectors/attachment-processing：解析中/截断/预算提示） | selectors/ |  已迁移：attachmentProcessing.ts + AttachmentProcessingStream.vue（从 turn 事件派生每个附件的 uploading/parsing/completed/fallback/failed 阶段，含上传中合成行与终态保留，接入 ChatPage，7 单测，2026-11-10） | P1 |
| C3 | 消息类型渲染（quiz/Geogebra/Mermaid/研究报告/视频课程等富事件） | messages/ + components/{quiz,research,video-lesson...} |  ✅ 已完成核心迁移：活动流呈现层已迁移（turnActivity.ts + TurnActivityStream.vue 替换两处原始 event.type 调试列表，7 单测，2026-11-10）；quiz 纯逻辑内核已迁移（src/quiz/：questionType.ts 六题型规范化/选项键解析/TF 规范化；unicodeDecode.ts 移植 #973 密集 \uXXXX 解码并保护代码/数学/行内代码；quizModel.ts 类型/流式题目提取去重排序/轮次 id/result 解析/followup 配置/summary/WS config；judge.ts 判题 WebSocket 状态机 + readFileAsBase64，可注入 socket；27 单测，2026-11-11）；answerState.ts 本地评分内核已迁移（多选题/判断/填空自动评分、开放式 learner 评、answerSummary 统计，与 QuizViewer 语义一致，10 单测）；QuizQuestionCard.vue 四题型交互卡片已迁移（选项/TF/填空/长文本、提交后对错反馈与解析、参考答案，legacy-quiz.css，7 组件单测，2026-11-11）；quizSession.ts 会话语义已迁移（导航进度、已答题数、答案 patch/重置保留图片、正确性展示、notebook 结果扁平化、索引 clamp，8 单测）；QuizViewer.vue 容器已迁移（进度条、上一题/下一题、作答后自动前进、末题 emit submit、重试本题、空态，6 组件单测，2026-11-11）；quizConfig.ts 配置内核已迁移（rebalanceCounts 等分/保留有效配比、reconcileQuizConfig 去冗余更新、题型切换、题数钳制、配比百分比、可提交校验，14 单测）；QuizConfigPanel.vue 出题配置面板已迁移（custom/mimic 模式、题数与难度、题型多选、配比条与逐题型数量、试卷路径/最大题数、未就绪提示，7 组件单测，2026-11-11）；messageQuiz.ts 消息级 quiz 提取已迁移（优先流式 content 事件、回退 metadata.result/summary/result 事件，6 单测）；ChatPage 已挂载 QuizViewer：助手消息按事件流/result 元数据渲染随堂练习，生成中显示「随堂练习（生成中）」，提交结果记入会话去重集合；quizResults.ts + ChatPage 已补全会话题库持久化（session_id/turn_id 双身份门禁、签名去重、POST /api/sessions/{id}/quiz-results），3 单测 + ChatPage 端到端组件测试，2026-11-11；随堂练习追问已补基础闭环：quizFollowup.ts 构造 chat 能力的 followup_question_context、答案图片附件与独立线程状态机，QuizFollowupPanel.vue 支持独立 WebSocket 追问、流式回答、活动事件、取消、历史 hydrate，并将 followup_session_id 回写题库 entry；QuizViewer 已提供已答题“继续追问”入口，2026-11-11；ask_user 结构化暂停卡已迁移：askUser.ts 解析 draft/tool_result/resolved 事件及 v2/legacy payload，AskUserCard.vue 支持多问题上限、单选/多选、选项说明、自由输入、跳过、提交状态与已答题只读摘要；ChatPage 已挂载实时/持久化卡片，并将 submit_user_reply 从纯文本扩展为 {text, answers}，2026-11-11；setup 凭据交接已迁移：setupSignals.ts 从 tool_result.tool_metadata 提取 setup_credential 并限制为站内 /settings 路径，同时收集 setup_applied 去重 id；SetupCredentialCard.vue 在持久化/实时消息中提示“不要粘贴密钥”并跳转设置页；ChatPage 监听 setup_applied 后重新读取 /api/settings/ui，立即同步主题与语言偏好，setupSignals/setupSync/ChatPage 测试覆盖，2026-11-11；伙伴草稿卡已迁移（partnerDraft.ts 校验 32 位 draft_id/name/soul，PartnerDraftCard 可编辑 name/description/emoji/language/color/soul、POST /api/partners/drafts/{id}/confirm、打开伙伴）；精通交接卡已迁移（masteryHandoff.ts 解析 tool_result/tool_metadata、open/new 去重与路由，MasteryHandoffCard 可编辑开场白、写入 pendingPrompt、继续/开始学习）；精通资料呈现已迁移（masterySourcePresentation.ts 严格限定 chat/mastery_path + teaching/reveal + 原生 source-page URL，MasterySourcePresentation 带凭据取图/objectURL/错误态），并接入 ChatPage 持久化/实时流，2026-11-12；Geogebra 富组件已迁移：geogebraCommands.ts（SetColor/SetLineThickness 样式命令分流 + 脚本注释剥离，5 单测）、Geogebra.vue（单例 deployggb.js 加载、GGBApplet 注入、逐命令容错、坐标/网格/视角设置、错误与失败命令提示）、visualizeResult.ts（renderer.native_renderer 判定、payload.data 命令/script 回退、title，4 单测），ChatPage 已在助手消息按 visualize 信封挂载 Geogebra，2026-11-11；研究报告配置已迁移：research.ts（模式/深度归一化、校验、WS 载荷含 manual 子主题与迭代、摘要、大纲归一化，8 单测）、ResearchConfigPanel.vue（四类研究类型、四级深度、manual 子主题/迭代控件、错误提示，3 组件单测），并已通过 CapabilityConfigCard.vue 挂入右侧活动面板，含确认门禁、修改后失效、按会话 localStorage 持久化，ChatPage 发送 deep_research 时携带 config，2026-11-11；ResearchOutlineEditor.vue + researchOutline.ts 已迁移（自动折叠/用户展开闩锁、标题与说明编辑、增删子主题、空标题校验、研究完成/失败重试状态，8+5 单测），并挂入 ChatPage：大纲预览可编辑确认，确认后以 persist_user_message=false 静默发起 confirmed_outline 续跑，2026-11-11；deepResearchReport.ts 已迁移（outline_preview 提取、两回合事件/报告合并、后续回合过滤、报告结构化完成判定、研究完成自动回聊天模式，8 单测），ChatPage 按原序号合并并抑制未完成报告正文，2026-11-11；视频讲解已迁移：videoLesson.ts（HTML artifact 过滤、最新可播放 result 回退、source=video_lesson 权威识别、代码/时长/修复次数提取，6 单测）、VideoLessonViewer.vue（沙箱 iframe 播放、新标签页打开、时长与重试徽标、Remotion 源码折叠），ChatPage 已挂载并允许正文在播放器后继续显示，2 组件单测 + ChatPage 持久化恢复测试，2026-11-11；数学动画已迁移：mathAnimator.ts（拒绝通用 response-only 载荷、artifact 过滤、video/image 模式、代码/耗时/render/视觉审查字段归一化，4 单测）、MathAnimatorViewer.vue（视频与图片输出、图片全屏、Manim 代码折叠、视觉审查警告、质量/重试/耗时徽标、嵌套滚动兼容），ChatPage 已挂载并避免正文重复，4 组件单测 + ChatPage 持久化恢复测试，2026-11-11；统一可视化查看器已迁移：visualizeResult.ts 完整解析 canvas/manim 信封（renderer/payload/presentation/analysis/review 与 legacy code fallback），visualizeRendering.ts 提供 SVG 多块拆分/净化/id 作用域、Chart.js JSON-ish 解析、HTML KaTeX/postMessage bridge，VisualizationViewer.vue 覆盖 SVG、Chart.js、Mermaid/思维导图、HTML iframe、插件 iframe、GeoGebra、Manim、全屏、代码查看/复制，ChatPage 已由旧的仅 GeoGebra 分支切换到统一查看器，2026-11-11；可视化配置闭环已迁移：visualizeConfig.ts（render_mode/quality/style_hint、Manim 模式判断、WS 载荷与摘要）、visualizerCatalog.ts（/api/visualizers list/install/enable/disable/delete/import）、VisualizeConfigPanel.vue（渲染模式目录、Manim 质量与风格、安装/启用/停用/卸载/zip 导入），并通过 CapabilityConfigCard 接入活动面板，支持确认门禁、修改失效、按会话持久化、ChatPage 发送 config，2026-11-11；已新增 markdownFences.ts 代码围栏解析器（mermaid/geogebra/plantuml 图表块结构化识别，9 单测，2026-11-10），作为富块渲染基础；mermaid 实际渲染已完成（已安装 mermaid ^11.17，MermaidBlock 懒加载独立 chunk + MarkdownView 围栏接入，失败回退代码块，3 单测，2026-11-10） | P1 |
| C4 | 主页 Composer 全套（StandaloneComposer/CapabilityConfigCard/ComposerTray） | components/chat/home/ |  ✅ 已完成核心对齐：能力选择/一次性 lead token、deep_question/deep_research/visualize 配置卡与确认门禁、可折叠可拖动 ComposerTray、StarterSuggestions、模型选择、上下文预算、语音、附件拖放、@ 空间引用、slash commands、知识库/技能/MCP/伙伴/子智能体/Persona/题库/收藏/书籍/阅读/记忆/历史等多路资源复用策略均已存在；SelectedResources 已升级为 ContextReferenceTree：多引用折叠摘要、单项直出、肘形连接线、上/下与左/右布局、缩略图、预览回跳对应 picker、逐项移除，保留 `.selected-reference-chips` 兼容层并补充组件/E2E 覆盖，2026-11-12。右侧 Side Chat 已另列 C6 并完成核心迁移 | P2 |
| C6 | 对话选区操作与 Side Chat（SelectionActions / ViewerLauncher / SessionViewerPanel side-chat tabs） | features/chat/components/SelectionActions.tsx、components/chat/home/{ViewerLauncher,SessionViewerPanel,SideChatResponderMenu,ResponderList}.tsx |  ✅ 已完成核心迁移：sideChat.ts/quoteAttachments.ts 对齐 selection context、Dito/伙伴/群组/子智能体 responder、start_turn、quote attachment 与普通附件；ChatPage 支持选中正文后“加入聊天 / 询问 Dito / 询问其他人”，主 composer 显示可移除引用；SessionViewerPanel 新增通用 side-chat tab、Dito 入口、独立 WebSocket 线程、文件附件、ask_user 续答、responder 切换、引文带入和 `/sessions/{id}/threads` 历史恢复；所有已打开 side chat 使用并存挂载，切换 tab 不丢失进行中状态；SideChatResourcesMenu 支持 LLM、Persona、知识库、技能、MCP，并复用题库/收藏/书籍/阅读/历史/记忆 picker，所有引用按主聊天契约写入 start_turn；补齐 ResourceReuse 持久策略：resourceReuse.ts 统一 canonical policy，SideChatPanel 每次发送携带 `_resource_reuse` / `_persistent_knowledge_bases`，Persona/知识库/技能/MCP/普通附件拥有每轮开关，一次性选择在发送后消费，群组/历史/记忆等 picker 复用同一生命周期；Responder 菜单按 Dito、子智能体、伙伴群组、伙伴分组并保留描述、选中态与阅读上下文说明；SideChatPanel/ResponderMenu/SelectionActions/ResourcesMenu、resourceReuse 及 ChatPage 端到端测试覆盖，2026-11-12 | P2 |
| C7 | Subagent / Partner Consultation 运行页（ConsultationTabBody / SubagentTabBody / SubagentRunTranscript / 嵌入式 PartnerChat / PartnerGroupChat） | components/chat/home/{ConsultationTabBody,SubagentTabBody,SubagentRunTranscript}.tsx、components/partners/* |  ✅ 已完成核心迁移：subagentTrace.ts 按 turn/call 分组咨询事件、按 subagent_merge_id 折叠流式 text/tool 行、解析 subagent/partner/group identity；SubagentRunTranscript.vue 已对齐 question/text/tool/reasoning/tool_result/error CLI 风格；SubagentTabBody.vue 支持 NDJSON 直聊同一 connected subagent、5 分钟空闲超时/取消/错误；SessionViewerPanel 新增 subagent tab 与 open/update API，ChatPage 监听每条消息及实时 stream 自动创建并刷新运行 tab；新增 groupDiscussion.ts 与 PartnerGroupDiscussion/PartnerGroupRound/PartnerGroupSeat：群组历史按 round/seat 稳定排序，WebSocket 支持 user_message/partner_started/partner_trace/partner_message/invocation_updated/done/cancelled/error，实时 trace 折叠、轮次进度、停止本轮；@成员支持多词显示名、@all/所有人、未知 token 提示与键盘选择；伙伴间 peer ask、invocation 待审批/接受/拒绝/等待/失败状态、用户主动提问自动审批、round summary、引用继续追问均已接入；共享白板与每位伙伴独立推理侧栏同步刷新；完整群组页与嵌入式 ConsultationTabBody 共用同一组件；嵌入式伙伴咨询补齐附件上传/粘贴/拖放、`/new`、`/clear`、`/branch`、`/resume`、`/delete`、`/sessions` 命令与归档当前对话，群组咨询活动会续期 idle countdown；顶部保留打开完整咨询入口，groupDiscussion/PartnerGroupDiscussion/PartnerConsultationPanel 单测与群组详情 E2E 覆盖，2026-11-12 | P2 |
| C5 | 会话追踪 trace（trace/） | features/chat/trace |  已迁移：traceSelectors.ts（call_id 分组、react_round 步骤折叠、substance/终态/streaming mode 判定，对齐旧 selectors.ts）+ TraceViewer.vue（GET messages/{id}/events、模态展示 trace/step、进行中徽标），ChatPage 助手消息加「调用追踪」入口，13 单测，2026-11-10 | P3 |

## 四、学习模块

旧版学习相关组件 69 个文件（learning/reading/watching/quiz/video-lesson/
math-animator/visualize/research/notebook），Vue3 33 个文件。

| # | 模块 | 旧版 | Vue3 | 优先级 |
|---|------|------|------|--------|
| L1 | 阅读器标注层（AnnotationLayer/Popover/List、Epub/Pdf 双视图、朗读 use-read-aloud、显示控制） | reading/ 14 文件 |  ✅ 已完成核心迁移：PDF 选区/批注叠加/列表/跳转/删除；EPUB 原生分页视图、CFI/quote 高亮、位置保存；统一字号/衬线/行宽/主题/双页显示偏好并持久化；朗读优先 POST read-aloud 音频、失败回退浏览器 speechSynthesis（111 文件/463+ 用例基线，2026-11-11） | P1 |
| L2 | 视频学习 WatchingBrowser + MarksPanel | watching/ |  ✅ 已完成核心迁移：videoLearning.ts + videoLearningMarks.ts（Invidious 账号/浏览、视频 marks CRUD、进度、cue 区间/locator/时间格式）；WatchingBrowser.vue 已接入添加资料；WatchingMarksPanel.vue 支持筛选/建议/跳转/复习/删除；MediaReadingStage.vue 已挂入 ReadingStudyPage，覆盖 YouTube iframe、Invidious HTML5 video/audio、字幕轨、逐段文稿跳转、进度保存与 marks 联动，2026-11-11 | P2 |
| L3 | 练习 practice 子系统 | learning/practice/ |  ✅ 已完成核心迁移：practice.ts 统一深链/复习进度/图表几何语义（单题与多题 `questions` 深链、显式 workspace、`again` 回队、`due_at` 最近到期日）；PracticePage 已对齐旧版 Markdown 题干/选项/答案解析、分类徽标、加载/保存状态、冲突重载与复习完成到期提示；QuestionBankPage 已支持所选/本页多题一次性练习、错题使用 `mistakes_only` 调度口径、练习 summary 数量与导入目标随集合切换；PracticeInsights + PracticeTrendChart 已迁移 7/30/90 天、三指标、折线/柱状、来源占比、键盘逐日查看和每日数据表。新增 4 个纯逻辑/图表测试文件覆盖，2026-11-11；全量门禁 121 文件/490 用例、typecheck、build 通过 | P2 |
| L4 | 精通之路 mastery | — | ✅ 组件较全（Wizard/QuestionCard/Outline/Celebration） | 基本完成 |
| L5 | 数学动画/视频课程渲染 | math-animator/video-lesson 组件 |  ✅ 已完成：MathAnimatorViewer/VideoLessonViewer 已迁移并接入 ChatPage，含视频/图片/沙箱 HTML/Manim/Remotion 代码与持久化恢复测试，2026-11-11 | P2 |

## 五、实施顺序（逐步迁移）

- **阶段 P0（模型设置可用且安全）**：M1、M2、M3、M8 —— 本轮开始
- 阶段 P1：M4-M7、M9、M10、M14、M18、C1、C3、L1
- 阶段 P2：M11-M13、S1-S3、C2/C4、L2/L3/L5
- 阶段 P3：S4/S5、C5 及体验打磨
- 每项交付：组件实现 + vitest 单测（参照 `ModelCatalogSettings.spec.ts` 模式）+ `npm run typecheck` + `npm run test:unit`

## 六、验证方式

1. `cd web-vue3 && npm run typecheck`
2. `cd web-vue3 && npm run test:unit`
3. 启动后端 `deeptutor start`，浏览器逐屏对照两版设置页交互
4. 后端契约以 `deeptutor/api/routers/settings.py` 为准，不新造端点

### 当前自动化门禁（2026-11-12）

- `vue-tsc --noEmit`：通过
- `vitest run`：145 个测试文件 / 545 个用例通过
- `npm run build`：通过
- `playwright test`：190 个真实 Chromium parity 用例通过
- `npm run routes:status`：65/65 React 路由已跟踪完成
- 真实后端验收：`deeptutor doctor --online` 返回 PASS；`/settings/llm-options` 返回 active `spark-x2.6`；真实 `/ws` start_turn 返回 `2+2 等于 4。`；Vue3 浏览器真实发送 `3+4` 收到 `7`，无 pageerror，历史重载后回答仍可见
