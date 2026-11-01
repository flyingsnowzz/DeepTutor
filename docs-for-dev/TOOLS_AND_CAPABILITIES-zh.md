> **中文译本**：本文件由英文原文翻译；命令、路径、配置键、代码块和链接目标保持原样，如译文与实现存在歧义，以英文原文和当前代码为准。

# 工具和功能

[手册](README.md) · [架构](ARCHITECTURE.md) · [模块](MODULES.md) · [插件](PLUGINS.md)

## 两份合同

[ `BaseTool`、 `ToolDefinition` 和 `ToolResult` ](../deeptutor/core/tool_protocol.py) 描述模型选择的一项操作。工具验证参数、执行操作并返回内容以及结构化元数据/错误状态。可用性并不等于访问每个资源的权限。

[ `TurnCapability` 和 `CapabilityManifest` ](../deeptutor/core/capability_protocol.py) 描述拥有转弯的管道。功能消耗 `UnifiedContext` 并发出流事件。响应负载和 `cost_summary` 的能力集中在 [ `emit_capability_result()` ](../deeptutor/agents/_shared/capability_result.py) 上；不要发明另一个完成信封。

内置目录由 [`builtin_capabilities.py`](../deeptutor/runtime/bootstrap/builtin_capabilities.py) 从 [`modules/manifests/`](../deeptutor/modules/manifests/) 派生。使用 `deeptutor module list`、 `deeptutor plugin list` 和 `deeptutor plugin info` 检查当前安装，而不是假设每个源功能在仅核心轮环境中可用。

## 安装规则

八个用户可切换工具是 `brainstorm`、 `web_search`、 `paper_search`、 `zotero_search`、 `reason`、 `geogebra_analysis`、 `imagegen` 和 `videogen`。  [`tools/builtin/__init__.py`](../deeptutor/tools/builtin/__init__.py)中的`USER_TOGGLEABLE_TOOL_NAMES`为权威列表； CLI `--tool` 从中进行选择。

`CONFIGURABLE_BUILTIN_TOOL_NAMES` 声明了上下文门控工具，包括研究、检索、记忆、笔记本、执行和延迟工具发现。 [ `tool_composition.py` ](../deeptutor/agents/_shared/tool_composition.py) 拥有安装标志和始终可用的工作区工具。能力拥有的解决、掌握和其他专业工具遵循其激活合同。合作伙伴允许/拒绝表面可以进一步缩小访问范围。

帐户授予、工作区资源策略、模块选择和功能激活都必须在发现和调度时保持有效。 UI 或清单中的工具名称不得绕过这些检查。 MCP/CLI 延迟发现必须使用现有加载程序，而不是安装并行注册表。

## 添加或更改内置

1. 在其所属模块中实现类型化操作或功能。将可选库排除在仅元数据导入之外。
2. 更新工具规范或功能声明、别名和所属模块清单。惰性工具描述符位于 [ `builtin_specs.py` ](../deeptutor/tools/builtin_specs.py) 中。
3. 将安装逻辑放入现有的组合/激活所有者中。明确决定工具是用户可切换的、上下文门控的还是功能拥有的。
4. 根据需要更新请求验证和翻译提示。 [`capabilities/prompts/`](../deeptutor/capabilities/prompts/)下实时显示能力提示；某些智能体实现在其自己的目录中拥有附加提示。
5. 测试元数据/实现奇偶性、缺失模块行为、授权资源范围、失败和取消以及公共结果信封。按照[测试](TESTING.md)进行架构重新生成和更广泛的检查。

对于独立分发的包，请使用[插件合约](PLUGINS.md)和[学习Echo示例](examples/learning_echo/README.md)而不是修改内置注册。阅读工具栏操作有一个单独的[阅读扩展协议](READING_EXTENSIONS.md)。

## 诊断意外的工具调用

将活动模块状态、功能、所选资源、用户工具选择和工作区策略与模型请求所允许的实际模式进行比较。然后检查调度和返回的证据。选定的 KB 并不证明检索已运行；检索到的 URL 并不能证明像素已到达模型。请参阅[来源可视化](SOURCE_VISUALS.md) 和[答案质量诊断](REASONING_SAFETY_CHECKLIST.md)。