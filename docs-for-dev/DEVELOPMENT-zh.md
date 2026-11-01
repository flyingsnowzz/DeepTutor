> **中文译本**：本文件由英文原文翻译；命令、路径、配置键、代码块和链接目标保持原样，如译文与实现存在歧义，以英文原文和当前代码为准。

# 开发 DeepTutor

[手册](README.md) · [架构](ARCHITECTURE.md) · [测试](TESTING.md)

## 准备源码环境

按照 [智能体设置](AGENT_SETUP.md) 进行 Python 3.11–3.14、Node.js 22 LTS、提供程序配置和准备。源代码检查公开了所有模块；在可编辑核心之前安装其外部依赖项：

```bash
python -m pip install -r requirements/full.txt
python -m pip install -e . --no-deps
python scripts/install_extras.py dev
cd web
npm ci --legacy-peer-deps
cd ..
```

使用 `scripts/install_extras.py` 来获取可选的源依赖项。在可编辑的结帐上安装功能轮可能会掩盖源所有权；使用单独的环境进行[wheel 包生命周期测试](MODULES.md#validation)。 FFmpeg 和 LaTeX 等系统可执行文件仍然是需要它们的功能的单独先决条件。

在更新之前检查 `git status`、活动分支和远程分支。针对`dev`开发； PR目标遵循[贡献政策](../CONTRIBUTING.md)。当并发工作需要隔离时，重用适当的任务签出或使用单独的工作树。保留不相关的编辑。将运行时数据和测试输出保留在 Git 之外。

## 使用专用的运行时主页

`DEEPTUTOR_HOME` 是拥有 `data/` 的目录，而不是 `data/` 本身。选择一个明确的私人开发主页并将其用于每个命令。例如，在新的外壳中：

```bash
export DEEPTUTOR_HOME="$HOME/.local/share/deeptutor-dev"
deeptutor init --non-interactive
deeptutor config show
deeptutor module list
```

不要将灯具指向现有学习者的运行时间。内容工作空间是一个独立的存储和授权范围；请参阅[工作空间](workspaces.md)。应用程序不会自动加载项目的 `.env` 文件。

## 运行并检查

对于组合启动器，使用 `deeptutor start` 并读取其输出中的实际 URL。对于单独的开发流程，请在具有相同选择的运行时主目录的两个终端中运行 API 和前端：

```bash
# Terminal 1: API, with reload
deeptutor serve --host 127.0.0.1 --port 8001 --reload
```

```bash
# Terminal 2: frontend, from web/
DEEPTUTOR_API_BASE_URL=http://127.0.0.1:8001 npm run dev
```

选择自由端口；不要停止不相关的服务。确认浏览器请求通过前端智能体到达预期的 API。单独的监听前端并不能建立提供者、模块或轮次准备状态。使用`deeptutor doctor --format json`和原用户操作进行验证。

## 对其所有者进行更改

1. 使用最少的合成夹具重现行为。确定所有者是否是适配器、共享运行时、功能、工具、功能存储、提供者或前端投影。
2. 阅读最近的实现及其测试。对于 API 更改，请通过身份验证、帐户/工作空间解析、持久性、事件和 UI 消耗来跟踪请求验证。
3. 更改该所有者，而不是添加第二个运行时、路径解析器、提供程序客户端或存储抽象。共享协议保持轻量级。
4. 受影响时更新模块声明、请求合同、提示和区域设置字符串。使用其所属脚本重新生成派生文件。
5. 运行[与更改相应的检查](TESTING.md)，重现原始操作，并在 PR 中解释任何验证限制。

对子流程使用显式参数列表和 `shell=False`；取消时保留进程树清理。通过现有帐户和工作区上下文来解决存储问题，而不是构建全局数据路径。切勿将凭据或私有提供商重放元数据返回给浏览器响应。

## 生成的文件和文档

该存储库有意跟踪生成的 API 合约、需求文件和依赖锁。更新其生成器或权威输入，然后重新生成。  `web/.next*`、安装的依赖项、字节码、日志和手动验收工件保持未跟踪状态。

当公共行为发生变化时，更新相关手册主题和自述文件链接。将可重用的可执行示例放在本手册的[`examples/`](examples/learning_echo/README.md)下。保持命令示例在存储库根目录中可用，并避免使用个人计算机路径。