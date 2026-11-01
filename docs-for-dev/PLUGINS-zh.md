> **中文译本**：本文件由英文原文翻译；命令、路径、配置键、代码块和链接目标保持原样，如译文与实现存在歧义，以英文原文和当前代码为准。

# 第三方插件开发

[手册](README.md) · [工具和功能](TOOLS_AND_CAPABILITIES.md) · [阅读扩展](READING_EXTENSIONS.md)

官方[模块轮子](MODULES.md)分享DeepTutor的解释器和版本。第三方插件有单独的清单、批准和生命周期合同。从可运行的 [Learning Echo 示例](examples/learning_echo/README.md) 开始，它声明了一个工具、功能、HTTP 路由和静态页面，无需外部 Python 依赖项。

## 清单和登记

包使用模式 `deeptutor.plugin/v1` 传送静态 `deeptutor.plugin.json`。阅读 [ `manifest.py` ](../deeptutor/plugins/manifest.py) 和 [示例清单](examples/learning_echo/learning_echo/deeptutor.plugin.json) 以获取确切的字段。它声明身份/版本、DeepTutor/API 兼容性、权限公开、依赖项关闭和类型化扩展。未知字段和无效路径将被拒绝。

| 扩大 | 运行时合约 |
| --- | --- |
| ‘工具’、‘能力’ | 主机入口点协议或批准的托管 JSON 工作线程 |
| `loop_capability` | 现有共享环路扩展协议 |
| `reading_extension` | 服务器验证的阅读上下文和有界结果类型 |
| `visualizer` | 类型化打包可视化器声明 |
| `http_route` | 主机插件命名空间下的托管工作端点 |
| `frontend_page` | 声明的静态资产通过限制性沙箱 CSP 提供服务 |
| `persistence_schema`、`app_connector` | 经批准的声明/自省；没有通用迁移或连接器执行 API |

内置 ID 优先。每个扩展都保留其自己的类型化协议。现有的 Python 入口点组在存在时会尊重根清单批准；新软件包不应依赖于旧版的无清单路径。 Discovery 无需导入第三方代码即可读取元数据。 [注册表](../deeptutor/plugins/registry.py) 区分可用、需要批准、启用、禁用、不兼容、损坏和弃用状态。

## 安装和批准

使用 `deeptutor plugin --help` 作为生命周期命令。托管安装接受本地轮子或解析来自供应商的 [`catalog.json`](../deeptutor/plugins/catalog.json) 的已审核条目。目录浏览/版本解析离线；显式安装会下载固定的工件。没有任意 URL 安装程序或自动后台升级。

目录工件绑定 HTTPS 轮 URL、SHA-256、大小和平台元数据。下载在 pip 之前拒绝重定向和大小/摘要不匹配。本地生命周期在导入代码之前验证来自wheel的清单，创建版本私有环境，并安装显式的仅限wheel的依赖闭包。它不会改变宿主解释器。

批准绑定规范化清单和工件身份。在批准之前检查当前快照。安装、升级、同一版本重新安装和回滚均需事先获得批准。批准不会自动启用本地禁用的插件。失败的安装保留以前的可用状态；保留版本支持回滚。外部主机安装的插件升级需要重新启动才能替换已导入的 Python 模块。

所有者是 [ `lifecycle.py` ](../deeptutor/plugins/lifecycle.py)，运行时状态为 `data/user/settings/plugins.json`。 API生命周期变更需要管理员授权。 [插件测试](../tests/plugins/)涵盖清单、工件、事务、恢复和批准边界。

## worker协议和取消

[ `runtime.py` ](../deeptutor/plugins/runtime.py) 使用插件环境的 Python 启动工作模块。worker申报不能超过批准的清单。旧版工作人员在 stdin/stdout 上交换一个 JSON 请求和响应。

能力可以在其描述中通告 `"transport": "ndjson-v1"`。然后它会发出包含 `{"kind":"event","event":{...}}` 和 `{"kind":"complete"}` 的 JSON 行。事件进入正常的持久回合流；工作人员不拥有并行的公共流。完成之前的 EOF 和格式错误的帧会使运行失败。请求、帧、输出、stderr 和执行都有界限；队列施加反压。取消关闭进程组并等待清理。该示例支持流式传输和传统模式。

## HTTP 和静态页面

托管 HTTP 路由使用 `/api/plugins/{plugin-id}{path}`，无法替代内置路由。主机解析批准、启用、兼容的托管状态并在启动工作程序之前进行身份验证。启用主机身份验证后，即使声明为 `public` 的插件路由也需要主机会话：它不会绕过主机帐户边界。 `admin` 策略添加管理员检查。不可用的插件路由返回 404。

Worker 接收声明的方法/路径、规范化查询值和有界 JSON 正文，而不是主机 cookie、不记名令牌或身份验证标头。响应已验证 JSON 状态/正文并受限 `Cache-Control`；重定向和身份验证响应属于主机。请参阅[API 测试](../tests/api/test_plugins_router.py)。

静态页面声明模式 `deeptutor.plugin-frontend-page/v1`、一个条目和一个显式资产关闭。仅可提供经批准的常规包文件；符号链接和未声明的资产被拒绝。规范 URL 是 `/api/plugins/{plugin-id}/pages/{extension-id}/`。保留相关资产的尾部斜杠。

页面在具有限制性 CSP 的沙盒浏览器上下文中运行，包括 `connect-src 'none'`；它们不会将 React/Next 代码注入主机包或任意获取主机 API。请参阅 [ `frontend.py` ](../deeptutor/plugins/frontend.py)、[前端测试](../tests/plugins/test_frontend.py) 和[示例页面清单](examples/learning_echo/learning_echo/frontend/page.json)。

## 信任限制和验证

权限声明和批准不是操作系统沙箱。主机入口点扩展在主机解释器中执行；托管工作人员隔离 Python 依赖项，但保留主机操作系统访问权限。查看实际的包和依赖项。打包的浏览器页面有自己的浏览器沙箱。不支持直接重复使用 Chrome 扩展程序。

验证清单，构建轮子，执行批准/启用、工作人员和页面，然后禁用/撤销并取消运行。使用一次性运行时之家。请参阅[测试](TESTING.md) 和单独的[读取扩展上下文/结果规则](READING_EXTENSIONS.md)。