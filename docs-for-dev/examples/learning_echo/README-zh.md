> **中文译本**：本文件由英文原文翻译；命令、路径、配置键、代码块和链接目标保持原样，如译文与实现存在歧义，以英文原文和当前代码为准。

# 学习 Echo 插件

[使用手册](../../README.md) · [插件合约](../../PLUGINS.md) · [测试](../../TESTING.md)

该包是托管插件运行时的参考实现。它声明了一种工具、一种功能、一种 HTTP 路由和一种静态前端页面。该页面仅请求`sandboxed-iframe` UI权限；该包没有 Python 依赖项。

## 封装布局

- [Manifest](learning_echo/deeptutor.plugin.json)：插件身份、权限和四个扩展声明。
- [Worker](learning_echo/worker.py)：描述、工具执行、能力流和 JSON HTTP 响应。
- [页面清单](learning_echo/frontend/page.json)：显式静态资源关闭； [index.html](learning_echo/frontend/index.html) 和 [app.js](learning_echo/frontend/app.js) 实现沙盒页面。
- [构建元数据](pyproject.toml)：打包worker、manifest和assets。

## 构建和检查

从存储库根目录构建本地轮子：

```bash
python -m pip wheel --no-deps -w /tmp/deeptutor-plugins docs-for-dev/examples/learning_echo
```

使用一次性 `DEEPTUTOR_HOME`，然后使用生成的wheel 包路径运行 `deeptutor plugin install` 并使用以下命令检查它：

```bash
deeptutor plugin show org.deeptutor.learning_echo
deeptutor plugin state
```

在调用 `deeptutor plugin approve org.deeptutor.learning_echo` 之前查看清单和工件；如果禁用它，则显式启用它。安装和批准是不同的状态。安装步骤在导入插件代码之前读取 `deeptutor.plugin.json` 并创建插件专用虚拟环境。

批准并启用后，该页面可在 `/api/plugins/org.deeptutor.learning_echo/pages/learning_echo_page/` 上使用。其进入和资产关闭在`learning_echo/frontend/page.json`中声明。

启用主机身份验证后，打开页面或其 `public` HTTP 路由仍然需要主机会话。该页面的 CSP 阻止任意网络访问；它不是注入主机前端代码的示例。

## 验证并适应

从存储库根目录：

```bash
python -m pytest tests/plugins/test_runtime.py tests/api/test_plugins_router.py
```

这些测试使用此包作为工作程序/页面固定装置。移动或更改示例时保留测试。对于新插件，选择不同的包/清单标识，声明实际权限和依赖项关闭，以及测试失败、取消、禁用状态和升级后重新批准。请参阅[插件指南](../../PLUGINS.md) 了解信任限制和回滚行为。