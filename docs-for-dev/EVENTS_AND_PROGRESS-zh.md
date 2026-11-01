> **中文译本**：本文件由英文原文翻译；命令、路径、配置键、代码块和链接目标保持原样，如译文与实现存在歧义，以英文原文和当前代码为准。

# 事件、持久重播和索引进度

[手册](README.md) · [架构](ARCHITECTURE.md) · [索引恢复](INDEXING_RECOVERY.md)

不同的事件系统有不同的持久性保证。从诊断的手术开始；进程本地通知不是持久的转向日志。

| 流动 | 主要业主 | 检查什么 |
| --- | --- | --- |
| 模型转 | [应用程序服务](../deeptutor/app/service.py)、[转运行时](../deeptutor/services/session/turn_runtime.py)、[StreamBus](../deeptutor/runtime/stream_bus.py) | 提交标识、持久序列、重播光标、终端事件 |
| 多人协调 | [协调员](../deeptor/runtime/coordination/) | 租赁业主、围栏、取消通知、恢复 |
| 知识摄取 | [进度跟踪器](../deeptutor/knowledge/progress_tracker.py)，[索引日志](../deeptutor/knowledge/indexing_run.py) | 任务标识、源结果、发布状态、上次活动 |
| 知识UI传输 | [进度端口](../deeptutor/knowledge/progress_events.py)、[广播者](../deeptutor/api/utils/progress_broadcaster.py)、[任务流](../deeptutor/api/utils/task_log_stream.py) | 快照、WebSocket 进度、SSE 日志/终端状态 |
| 处理通知 | [EventBus](../deeptutor/events/event_bus.py) | 当前的发布者/订阅者；进程寿命 |

## 转动生命周期

应用程序服务通过共享会话存储和运行时协调准入和执行。每个执行都有一个每轮流总线；在适配器将事件传递给消费者之前，事件必须进入持久化/重播路径。浏览器断开连接本身并不证明转向失败或授权第二次执行。恢复必须区分活动租约和丢失的工作人员并保留最终状态。

更改流时，测试重复提交、部分输出后重新连接、终端事件后重播、取消和工作人员丢失。保留事件 ID/序列和现有投影规则，而不是将到达顺序或渲染文本视为持久的事实来源。协议类型位于 [ `core/stream.py` ](../deeptutor/core/stream.py) 中；前端使用 [ `web/contracts/` ](../web/contracts/) 下的合约。

一名工作人员可以使用内存协调器。多个后端工作者需要 Redis 协调，通过 `system.backend_workers` 和 `integrations.turn_coordination` 配置。 [设置验证器](../deeptutor/runtime/coordination/settings.py) 拒绝具有内存协调器的多个工作进程，并拒绝没有 URL 的 Redis。 Redis是协调/通知层；它不会取代会话存储。  `deeptutor doctor runtime --format json` 报告运行时诊断。

## 知识库进展

`ProgressTracker` 保留快照并通过注入的进度端口发出。 API 安装 WebSocket/SSE 端口；域代码不得导入 FastAPI 来报告进度。 CLI/SDK 执行仍然可以在没有浏览器广播器的情况下保持进度。

知识路由器公开进度 WebSocket 和任务日志 SSE 流。 [ `useKnowledgeProgress` ](../web/hooks/useKnowledgeProgress.ts) 将它们组合起来，跟踪预期任务并协调最终状态。重新连接或应用快照时保留工作区范围和任务标识。对数和百分比估计是观察结果，而不是索引已发布的证据。

[索引日志](INDEXING_RECOVERY.md) 记录源级成功、失败和中断的工作。完成必须与持续发布一致；解析器到达最后一批是不够的。重建不得用部分候选版本替换可查询版本。要解析检查点和精确的源定位器，另请阅读[来源可视化](SOURCE_VISUALS.md)。

## 调试顺序

1. 识别帐户、工作区、会话/回合或知识库/任务 ID 和时间窗口。
2. 首先检查持久状态，然后检查协调员/工作人员和运输。
3. 将浏览器的光标/任务标识与服务器的持久状态进行比较。
4. 使用固定装置重现断开的连接、旧快照和重复帧。不要通过手动覆盖成功字段来修复进度。
5. 重新打开后验证终端状态，而不仅仅是在原始浏览器连接保持活动状态时。

相关套件包括[应用测试](../tests/app/)、[协调测试](../tests/runtime/coordination/)、[知识测试](../tests/knowledge/)和[知识进度WebSocket测试](../tests/api/test_knowledge_progress_ws.py)。