> **中文译本**：本文件由英文原文翻译；命令、路径、配置键、代码块和链接目标保持原样，如译文与实现存在歧义，以英文原文和当前代码为准。

# DeepTutor 开发者和智能体手册

从这里开始安装、诊断或更改 DeepTutor。本手册描述了 **1.7.0 源代码树**；在开发另一个版本时，请使用同一标签中的文档。版本号的权威来源为[`deeptutor/__version__.py`](../deeptutor/__version__.py)。除非页面另有说明，否则以下命令从存储库根运行。

## 选择阅读路径

- [网站学习平台：共享内容与多学习包架构](网站学习平台-共享内容与多学习包架构.md)：公共知识图谱、教材讲义、题库解析、个人学习状态与学习包设计。
- [项目全景导览（中文）](PROJECT_WALKTHROUGH-zh.md)：从一次请求出发，理解运行时、Tool、Capability、模块、服务、前后端与数据目录。

| 你的任务 | 按顺序阅读 | 完成证据 |
| --- | --- | --- |
| 安装并配置应用程序 | [智能体设置](AGENT_SETUP.md) → [存储](DATA_STORAGE.md) | 依赖项、模块就绪状态、实际模型响应、可访问的应用 |
| 修复现有安装 | [设置疑难解答](AGENT_SETUP.md#6-疑难解答) → 以下相关主题 | 原始失败操作在同一实例和工作区中有效 |
| 开发变更 | [开发](DEVELOPMENT.md) → [架构](ARCHITECTURE.md) → [测试](TESTING.md) | 重点回归和适用的项目检查 |
| 添加工具或功能 | [工具和能力合约](TOOLS_AND_CAPABILITIES.md) → [模块](MODULES.md) | 注册、可用性、执行和最终结果测试 |
| 构建第三方扩展 | [插件](PLUGINS.md) → [可运行的 Learning Echo 示例](examples/learning_echo/README.md) | 轮子、清单、批准、worker和前端检查 |
| 研究流或内存 | [事件和进度](EVENTS_AND_PROGRESS.md) → [运行时设计](RUNTIME_DESIGN.md) | 持久/重放和取消证据 |
| 部署或升级 | [模块](MODULES.md) → [容器](CONTAINERIZATION.md) → [存储](DATA_STORAGE.md) | 匹配版本、保留数据、就绪状态和代表性回合 |

对于支持终端的智能体，请在编辑之前阅读此索引、[AGENTS.md](../AGENTS.md) 和任务指南。 [SKILL.md](../SKILL.md) 是紧凑的 CLI 参考。在遵循示例之前，请检查签出、工作树更改、Python 环境和运行时主页。将现有用户数据和凭证与一次性测试装置分开。在决定重新安装之前诊断失败的安装。

## 主题图

### 运行时和扩展开发

- [架构和源码所有者](ARCHITECTURE.md)：入口点、持久转弯、前端边界和配置。
- [工具和功能](TOOLS_AND_CAPABILITIES.md)：单次工具、回合拥有管道、上下文门和结果包络。
- [模块](MODULES.md)：分发所有权、安装和生命周期。
- [插件](PLUGINS.md)：清单、审核、工作人员、HTTP 和静态页面。
- [阅读扩展](READING_EXTENSIONS.md)：验证选择上下文和有界结果。
- [事件和进度](EVENTS_AND_PROGRESS.md)：将重播与索引进度和进程本地通知进行比较。
- [运行时设计](RUNTIME_DESIGN.md)：延迟加载、隔离解析、私有模型历史记录和提示缓存可观察性。
- [远程 Hermes 后端](remote-hermes-backend.md)：网关协议和 Connected Agents 集成。

### 存储、部署和能力契约

- [数据存储](DATA_STORAGE.md) 和[工作空间](workspaces.md)：运行时主目录、帐户/工作空间范围、备份、资源分配和迁移。
- [容器化](CONTAINERIZATION.md) 和[请求筛选](SECURITY_GUARD.md)：部署配置、OAuth 回调端口和智能体边界。
- [知识迁移](KNOWLEDGE_MIGRATION.md)、[索引恢复](INDEXING_RECOVERY.md)和[来源可视化](SOURCE_VISUALS.md)：摄取、发布、原始证据和视觉评估。
- [科学研究](SCIENTIFIC_RESEARCH.md)：论文工具、证据和MCP授权。
- 【练习】(PRACTICE.md)：试题导入、复习记录和排班。
- 【视频学习】（watching-workspace.md）和【语音】（VOICE_CONFIGURATION.md）：阅读媒体迁移、字幕、语音适配器和验证。
- [答案质量诊断](REASONING_SAFETY_CHECKLIST.md)：可重复的检索、引用、上下文和评估失败。

## 保持本手册有用

为每份合同保留一个规范页面并链接到它。每个主题都应该指向其实现所有者或回归测试。当命令、路由、所有权或存储发生变化时更新受影响的示例；生成的模式和模块清单优先于散文。记录检查证明的内容，包括提供商/网络或平台限制。

将任务计划、一次性测试计数、屏幕截图、私有路径、下载的参考存储库和不相关的产品研究排除在本手册之外。使用 PR 或本地忽略的输出作为执行证据。在找到并验证设计方案的实现之前，设计方案并不是当前的行为。