> **中文译本**：本文件由英文原文翻译；命令、路径、配置键、代码块和链接目标保持原样，如译文与实现存在歧义，以英文原文和当前代码为准。

# 沉浸式阅读扩展

[使用手册](README.md) · [相关指南](PLUGINS.md)

沉浸式阅读通过 `deeptutor.reading_extensions` Python 入口点组发现服务器端包。 DeepTutor 在该组中提供朗读、学习指导、词汇、测验和明确目标翻译扩展；当未安装扩展时，阅读器不会呈现扩展工具栏。

入口点解析为具有经过验证的 `manifest` 和 `run_action(action, context)` 方法的对象或类。当前协议版本为 `1`。

```toml
[project.entry-points."deeptutor.reading_extensions"]
example = "example_reading_plugin:ExampleExtension"
```

```python
from deeptutor.reading.extensions import (
    ReadingAction,
    ReadingExtensionManifest,
    ReadingExtensionResult,
)


class ExampleExtension:
    manifest = ReadingExtensionManifest(
        id="example",
        version="1.0.0",
        name="Example",
        actions=[ReadingAction(id="explain", label="Explain")],
        result_types=["card"],
    )

    def run_action(self, action, context):
        return ReadingExtensionResult(
            type="card",
            title="Example",
            payload={"body": context.visible_text[:500]},
        )
```

## 安全边界

- 全局Reading API认证策略对扩展路由进行保护。
- 服务器解析素材、定位器、保存的源锚点和存储的单元文本；浏览器无法用任意值替换它们。
- 仅当选择在存储单元中逐字出现时才会转发。
- 扩展返回四种经过验证的结果类型之一： `card`、 `quiz`、 `feedback` 或 `browser_speech`。
- 结果的序列化上限为 64 KB。测验和语音有效负载接受额外的形状和长度验证。
- 大于协议 60,000 字符上下文上限的单元会因客户端错误而被拒绝，而不是调用扩展。
- 操作有 30 秒的执行超时，超过时返回标准的可恢复不可用性响应。已经在线程中运行的同步 Python 处理程序无法安全地终止，因此每个扩展都有一个私有工作线程，并且其电路在超时后保持打开状态；稍后的调用会快速失败，而不是在进程范围的线程池上消耗或排队工作。修复或移除卡住的扩展后重新启动 DeepTutor。
- 结果数据呈现为 React 文本。扩展程序无法将 JavaScript 或原始 HTML 发送到 Reader。
- 发现和执行失败是隔离的。损坏的可选包不能阻止文档或其他扩展的打开。

协议更改必须在版本 `1` 内保持向后兼容。未来不兼容的合约必须使用新的协议版本，而不是改变现有字段的含义。

## 实施与验证

- [deeptutor/reading/extensions.py](../deeptutor/reading/extensions.py)