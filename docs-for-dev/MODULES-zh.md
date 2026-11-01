> **中文译本**：本文件由英文原文翻译；命令、路径、配置键、代码块和链接目标保持原样，如译文与实现存在歧义，以英文原文和当前代码为准。

# 模块及安装

[使用手册](README.md) · [相关指南](TESTING.md)

DeepTutor 有一个源代码存储库和不相交的 Python 发行版。  `deeptutor`拥有共享的turn运行时、CLI和Python SDK。功能发行版将代码添加到同一包命名空间中，而不会覆盖核心文件。  `deeptutor-cli`是一个兼容性元包：它依赖于核心并且不拥有Python文件或控制台脚本。  `deeptutor[full]` 是一个安装配置文件，而不是一个会阻止删除单个应用程序的永久元包。

模块化发行系列从 1.7.0 开始，并且必须在每个版本中一起发布。 1.6.15 及更早版本的包使用以前的布局并且没有这些边界。还支持本地轮子构建。

## 来源结账

```sh
python -m pip install -r requirements/full.txt
python -m pip install -e . --no-deps
(cd web && npm ci --legacy-peer-deps)
deeptutor module list
deeptutor module disable solve
deeptutor module enable solve
```

在结帐中，所有源模块都存在。  `enable` 和 `disable` 采用与wheel 包安装相同的装配规则。  `install`和`uninstall`故意需要wheel环境，因此它们永远不会删除跟踪的源文件。源需求由 `python scripts/sync_module_requirements.py` 生成。在 CI 中使用 `--check` 检测漂移。  `requirements/core.txt`和`server.txt`是最小的；  `full.txt` 提供普通的完整源代码/Docker 运行时。源档案和 Docker 映像可由项目文件和模块构建脚本识别，无需 `.git`。可以使用 `python scripts/install_extras.py <extra>` 添加可选的源依赖项；这解决了模块需求，而无需在源树上安装重复的功能轮。

## 独立轮安装

```sh
python scripts/build_modules.py --output dist/modules
python -m venv /tmp/deeptutor-modules
/tmp/deeptutor-modules/bin/python -m pip install --find-links dist/modules deeptutor
/tmp/deeptutor-modules/bin/deeptutor module install solve --wheelhouse dist/modules
/tmp/deeptutor-modules/bin/deeptutor module install renderer-manim --wheelhouse dist/modules
/tmp/deeptutor-modules/bin/deeptutor module disable solve
/tmp/deeptutor-modules/bin/deeptutor module enable solve
/tmp/deeptutor-modules/bin/deeptutor module uninstall solve --dry-run
/tmp/deeptutor-modules/bin/deeptutor module uninstall solve
```

在 Windows 上使用等效的 `Scripts/python.exe` 和 `Scripts/deeptutor.exe`。使用与应用程序相同的 `DEEPTUTOR_HOME` 运行命令。 Python 包按环境安装；启用状态存在于 `<home>/data/system/modules.json` 中并适用于该部署，而不是一个学习者。  `--wheelhouse` 通过本地制造的轮子补充了套件索引。

为 API 安装 `server`，然后为打包的 Web 资产安装 `web`。 Web轮需要`scripts/prepare_web_package.py`为`deeptutor start`生成的资产；源开发服务器使用结帐的 `web/` 目录。构建和发布自动化在构建 Wheel 系列之前准备 Web 资产。

## 从1.6.15升级

停止旧进程并备份其运行时主页。首先使用打包的 Web 资产构建候选轮。在旧环境的一次性副本中，使用 `python -m pip install --upgrade --find-links dist/modules "deeptutor[full]==<candidate-version>"` 进行升级。如果安装了旧版 `deeptutor-cli`，请首先使用 `python -m pip uninstall deeptutor-cli` 卸载它，然后运行升级命令，可以选择添加新的兼容性别名。旧版 CLI 拥有与新核心相同的 Python 文件：pip 在删除旧 CLI 之前安装其新核心依赖项，这会删除新文件。首先删除旧的 CLI 可避免这种冲突并保留运行时主数据。对于仅 CLI 迁移，请在卸载后安装 `deeptutor-cli==<candidate-version>`。使用确切的候选版本以避免解析较旧的已发布版本。保持 `DEEPTUTOR_HOME` 不变，运行 `pip check`，检查 `deeptutor module list`，并在升级真实环境之前练习聊天、持续会话和 Web 启动。切勿针对用户数据的唯一副本进行测试。裸核心升级不保留旧的完整应用程序配置文件。

`deeptutor/__version__.py` 是所有构建的版本源，包括源 CLI 兼容性包。附加内容是 `tool.deeptutor.optional-dependencies` 中的模板； setuptools 和模块构建器都将其内部引脚解析为该版本。版本更新不得留下指向先前模块系列的依赖项。

## 所有权和组装

`deeptutor/modules/manifests/*.json`是权威目录。每个清单都拥有路径、依赖项要求、转向能力、循环扩展、工具名称、API 路由器和授权策略、CLI 组、导航路径和后台服务回调。最长的匹配路径获胜。共享协议和轻量级上下文元数据保留在核心；功能实现保留在自己的发行版中。构建器拒绝重叠的轮文件。

| 模块系列 | 内容 |
| --- | --- |
| 核 | 持久轮流、聊天、提问、共享工具、CLI/SDK、设置和会话 |
| 服务器/网络 | API 和身份验证适配器/打包的 Next.js 资产 |
| 解决/问题/研究 | 规划循环/问题生成/研究流程 |
| 可视化/渲染器-manim | HTML/SVG/图表可视化工具/可选的 Manim 管道 |
| 视频课程/音频概述 | 浏览器课程/音频概述生成 |
| 知识/解析 | 检索和摄取/文档解析实现 |
| 阅读/掌握/书籍 | 边读边看/引导学习/书籍应用 |
| 内存/笔记本/合写者/日历 | 可选的申请服务及其路线 |
| 合作伙伴/提供商 | 配套运行时和通道 SDK/可选模型提供程序 SDK |
| 解析器-* | 额外的解析器依赖分布，需要解析 |

依赖项是显式的和非循环的。例如，阅读目前需要知识、解析、掌握和笔记本，因为其应用程序使用这些存储。书籍还需要对其标准章节块和选定来源的基础进行提问、可视化和掌握。可选集成单独列出：日历在没有掌握的情况下工作，研究和问题在没有知识的情况下工作，解析从不导入知识存储。选择不可用的集成会返回安装提示。知识前沿需要研究和知识；工具贡献可以声明额外的要求，而无需将这些模块强制到其所属应用程序的每次使用上。禁用依赖项将被阻止，直到其启用的依赖项被禁用为止。卸载依赖项会被阻止，而任何已安装的依赖项仍然存在，包括禁用的依赖项。启用/安装会按顺序解决依赖项。无法禁用或删除核心。

加载程序不会导入缺失或禁用的功能/循环实现。请求模式是惰性的。循环扩展每回合实例化一次，并且随着上下文的变化重新评估激活；实例永远不会跨回合共享。托管插件吊销仍处于检查状态。后台启动/停止回调保持配对以进行部分启动回滚。现有的 API 身份验证策略保留在贡献的路由器上；模块状态不是权限授予。

`GET /api/modules` 需要身份验证并单独公开已安装、启用和准备就绪。运行时设置页面显示这些状态和离线命令。侧边栏和页面访问使用导航所有权； API 路由组装还排除缺少的模块，包括共享路由器中特定于功能的路径。就绪状态检查包要求、匹配核心/模块版本和外部可执行文件。配置的提供商凭据和服务连接保留在现有设置就绪系统中。

## 生命周期保证

官方模块共享一个解释器。运行的应用程序容器持有共享环境租约；模块更改需要跨进程的独占租用。当不同的 Python 环境共享同一个 home 时，第二个租约可以保护部署选择。在更改包或选择之前停止 CLI 轮流和 API 工作线程。该咨询锁无法阻止直接外部 `pip` 命令。

安装首先解决依赖项，拒绝替换现有的软件包版本，并在修改环境之前构建精确解析的工件。如果添加软件包后安装失败，那些新添加的发行版将被删除，包括保存选择失败时。在任何包突变之前，畸形选择都会被拒绝。仅在包操作成功后才会自动替换选择。使用新环境或显式环境升级来解决依赖性冲突。这不是机器崩溃时的原子文件系统事务；标准 pip 修复/重新安装仍然是中断机器的恢复路径。

卸载仅删除选定的发行版。共享依赖项会被保留，因为其他应用程序可能会使用它们。用户设置、会话、笔记本、知识库、生成的工件和凭据永远不会被清除。重新安装使用保留的数据。没有隐式数据删除命令。

现在，从正在运行的设置/设置会话安装解析器包会返回脱机模块命令。它不再在活动回合下升级包。模型权重下载仍然是后台作业，因为它们不会改变 Python 代码。第三方托管插件保留其现有的隔离环境。

## 第三方工作人员扩展

托管插件工作人员使用自己的环境和生命周期，与官方模块轮分开。请参阅[插件流式传输和取消](PLUGINS.md#worker-protocol-and-cancellation) 和[可运行示例](examples/learning_echo/README.md)。

## 验证

```sh
python scripts/sync_module_requirements.py --check
python -m pytest tests/modules tests/test_packaging_metadata.py
python scripts/build_modules.py --output dist/modules
python scripts/check_module_install.py --wheelhouse dist/modules --extended
```

安装 Smoke 创建一次性虚拟环境，使用本地模拟模型（无提供商凭据），检查核心聊天和持久重播，安装 Solve，运行它，卸载它，验证持久文件，再次检查核心，然后重新安装 Solve。扩展模式无需知识或掌握即可安装解析、研究和日历，练习解析及其缓存以及独立的研究和日历路径，然后在验证解决和保留的数据时删除每个模块。源隔离测试还禁止在 25 个模块中的每个模块的新子流程中进行未声明的导入，并汇总它们的贡献。 Manim 另外还需要系统渲染库、FFmpeg 和 LaTeX。渲染和取消测试应伴随其渲染器的更改。 Web 应用程序仍然是一种前端分布；可独立替换的第三方前端包不在此 Python 模块合同之外。

## 实施与验证

- [deeptutor/模块/清单/](../deeptutor/modules/manifests/)
- [脚本/build_modules.py](../scripts/build_modules.py)
- [脚本/check_module_install.py](../scripts/check_module_install.py)