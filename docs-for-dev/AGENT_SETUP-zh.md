> **中文译本**：本文件由英文原文翻译；命令、路径、配置键、代码块和链接目标保持原样，如译文与实现存在歧义，以英文原文和当前代码为准。

# 与您的智能体一起设置 DeepTutor 并排除故障

[使用手册](README.md) · [开发](DEVELOPMENT.md) · [模块](MODULES.md) · [存储](DATA_STORAGE.md)

本指南适用于外部智能体为用户安装、配置和验证 DeepTutor，或调查现有安装中的问题。对于现有问题，请从[故障排除](#6-troubleshooting) 开始，而不是重复安装。阅读 [SKILL.md](../SKILL.md) 了解 CLI 概述。您需要终端和文件访问权限；此流程不需要 MCP 或特定于智能体的插件。

## 1. 设定目标

仅询问缺失的信息并在等待时继续独立准备：

- 安装文件夹和任何现有的 DeepTutor 结账。
- 完整的 Web 应用程序或仅限 CLI；默认为完整应用程序的自述文件设置提示。
- 目标版本或分支。本指南介绍了当前的`dev`，包括1.7.0模块化布局；使用旧稳定版本的匹配文档。
- LLM 提供商、确切的模型 ID 和任何自定义/本地端点。
- 凭证来源：现有环境变量、用户标识的私有本地文件或提供者登录。不要在聊天时索要钥匙。
- 现在是否需要知识库/RAG；这些也需要嵌入。搜索是可选的。

重用合适的签出/环境并保留本地编辑和设置。使用用户现有的 `DEEPTUTOR_HOME`，或明确选择运行时主目录。拥有`data/`；它不是 `data/` 目录本身或用于学习材料的内容工作区。

## 2.克隆并安装

对于当前 `dev` 的全新完整应用程序安装（macOS/Linux 示例）：

```bash
git clone --branch dev https://github.com/HKUDS/DeepTutor.git
cd DeepTutor
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements/full.txt
python -m pip install -e . --no-deps
cd web
npm ci --legacy-peer-deps
cd ..
```

此流程使用 Python **3.11–3.14** 和 **Node.js 22 LTS**。在创建环境之前检查实际的解释器；  `python3` 可能更旧。在 Windows 上，使用受支持的 `py -3.X` 和 `.venv\Scripts\Activate.ps1`。如果 shell 状态在工具调用之间不持久，请通过绝对路径调用环境的 Python 和 `deeptutor`，并将环境变量传递给每个进程。

对于从源代码使用 CLI，请保留上面的 Python 安装并跳过 Node/npm。源树公开了所有签入的模块，因此它仍然需要它们的 Python 依赖项。在1.7.0封装布局中，`deeptutor`提供了最小的CLI；  `deeptutor-cli` 是同一核心的兼容性别名。根据需要添加功能模块；这不是已发布的 1.6.15 包的布局。

1.7.0 包布局使用 `python -m pip install "deeptutor[full]"` 来构建完整的 Web 应用程序。裸机`deeptutor`包含核心聊天、CLI和SDK；它不包含服务器或 Web 资产。对于开发构建，请使用上面的源流程或[模块](MODULES.md)中描述的本地轮子。

从 1.6.15 升级时，停止 DeepTutor，备份现有的运行时主目录，并继续使用相同的 `DEEPTUTOR_HOME`。要安装 1.7.0，请运行 `python -m pip install --upgrade "deeptutor[full]==1.7.0"`，然后运行 ​​`python -m pip check` 和 `deeptutor module list`，然后重新启动。如果安装了旧版 `deeptutor-cli` 软件包，请在安装新软件包 `python -m pip uninstall deeptutor-cli` 之前卸载它。它的旧轮子拥有共享的Python文件，一个命令升级可以删除新安装的核心。这不会删除运行时主目录数据。然后，您可以将 `deeptutor-cli==1.7.0` 添加到新的仅元数据兼容性别名的安装命令中。对于仅 CLI 迁移，请在删除旧 CLI 后安装 `deeptutor-cli==1.7.0`，并添加所需的任何功能模块。

1.7.0中，升级裸机`deeptutor`仅选择核心；使用 `[full]` 保留完整的应用程序功能集。在此升级期间，请勿重置设置或更改运行时主目录。对于现有的签出，在更新之前检查其分支、提交和本地编辑；不要默默地切换分支或更换环境来匹配此示例。


## 3、初始化无提示

为初始化、配置、诊断和启动保留相同的运行时位置。本示例使用 checkout 根；当用户拥有现有房屋时，请使用现有房屋：

```bash
export DEEPTUTOR_HOME="$PWD"
deeptutor init --non-interactive
deeptutor config providers
```

`init --non-interactive` 无需选择型号或联系提供商即可创建缺失的默认值，并保留已保存的设置。  `--cli`也被接受；在这两种模式下都不会运行向导。仅初始化并不能建立模型就绪状态。

`config providers` 将支持的 LLM、嵌入和搜索提供程序打印为 JSON，并使用默认端点和 LLM API 格式。使用其提供商 ID。  `init`、`config apply` 和 `config show` 也接受 `--home PATH`；对于其他命令，请一致使用 `DEEPTUTOR_HOME`。

## 4. 应用配置

编写一个 UTF-8 JSON 文件，例如 `setup.json`，用用户的选择替换模型占位符：

```json
{
  "llm": {
    "provider": "openai",
    "model": "YOUR_MODEL_ID",
    "api_key_env": "DEEPTUTOR_SETUP_LLM_KEY"
  },
  "system": {
    "backend_port": 8001,
    "frontend_port": 3782
  }
}
```

由 `api_key_env` 命名的变量必须存在于 CLI 进程的环境中。从用户的授权来源读取它，而不进行回显。 JSON 包含变量名称，而不是文字键。解析的密钥保存在 DeepTutor 的私人设置中，以供以后启动。项目根 `.env` 文件不会自动加载。

```bash
deeptutor config apply setup.json --check
deeptutor config apply setup.json
deeptutor config show
```

`--check` 验证输入、提供程序、命名凭据、端点和端口冲突，而无需编写设置或联系提供程序。两种模式都会发出 JSON；无效输入退出并显示代码 2。应用程序为每个提供的服务选择专用的 **智能体设置** 配置文件。重复它会更新那些相同的配置文件；保留其他配置文件和省略的服务/设置。每次都提供完整的个人资料，包括凭据参考。端口更改在重新启动后生效。

| 部分 | 必填字段 | 可选字段 |
| :--- | :--- | :--- |
| `llm` | `provider`、`model` | `base_url`、`api_key_env`、`api_version`、`api_format` |
| `embedding` | `provider`、`model` | `base_url`、`api_key_env`、`api_version`、正整数`dimension` |
| `search` | `provider` | `base_url`、`api_key_env` |
| `system` | 至少一个端口 | `backend_port`、`frontend_port`（整数 1–65535，不同） |

远程密钥认证的 LLM/嵌入提供商需要 `api_key_env`；本地、OAuth 和 `custom` 端点可能会省略它。搜索需求来自`config providers`。没有默认端点的提供商需要 `base_url`。 LLM API 格式为 `auto`、 `openai_chat`、 `openai_responses` 和 `anthropic`，具体取决于提供商的支持列表。 URL 中的未知字段、文字 `api_key` 字段和凭据将被拒绝。高级设置和其他服务类型在 Web 设置中仍然可用。

对于知识库/RAG，还配置一个可访问的嵌入模型。例如：

```json
{
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "api_key_env": "DEEPTUTOR_SETUP_EMBEDDING_KEY",
    "dimension": 1536
  },
  "search": { "provider": "duckduckgo" }
}
```

嵌入 `base_url` 为完整端点，如 `https://api.openai.com/v1/embeddings`；目录像 Web UI 一样对其进行规范化。更改现有知识库的嵌入模型/维度需要规划重建。不需要时省略搜索，或选择 `none` 禁用它。 DuckDuckGo 不需要钥匙；可用性取决于用户的网络。

对于本地 Ollama，使用 `{"llm":{"provider":"ollama","model":"YOUR_LOCAL_MODEL"}}` 并验证 Ollama 正在运行且模型可用。

对于 OAuth，应用 `config providers` 中的提供程序 ID/模型，然后在同一运行时主目录中使用其现有登录命令。用户完成任何登录交互：

```bash
deeptutor provider login openai-codex
# Other supported flows: github-copilot, codebuddy
```

OpenAI Codex 使用 DeepTutor 自己的 OAuth 凭证；外部智能体的登录不会自动重用。登录不选择型号。

## 5. 验证并启动

```bash
python -m pip check
deeptutor module list
deeptutor doctor --format json
deeptutor doctor --online --format json
```

`pip check` 检查依赖性一致性。检查 `module list` 是否有用户所需的模块：已安装、启用和就绪是不同的状态。 Web应用程序需要服务器和Web； RAG需要知识和解析；可选功能需要有自己的模块。仅核心有意省略这些模块。源结帐使用 `module enable/disable`；轮式安装还支持`module install/uninstall`。在更改之前停止 DeepTutor，并使用 `--wheelhouse /path/to/wheels` 来处理未发布的模块。请参阅[模块](MODULES.md)。

`doctor`检查本地就绪状态；  `doctor --online` 发出小型真实模型请求，可能会导致提供商使用。检查退出状态和所需的失败。修复可操作的故障并重新运行受影响的检查。仅保存的设置并不能证明准备就绪。 LLM 探针不验证可选嵌入：当请求 RAG 时，还要在“设置”中测试其连接并摄取/搜索用户批准的小型文档。

对于完整的应用程序：

```bash
deeptutor start --detach --no-browser
```

读取实际的启动器 URL，验证后端 `/health/ready` 并确认前端响应。默认为后端 `http://127.0.0.1:8001` 和前端 `http://127.0.0.1:3782`；如果不同，则使用报告的端口。检查启动器日志是否失败。通过`config apply`选择空闲端口，而不是停止不相关的进程。对于仅 CLI，跳过 Web 启动并验证轮次执行：

```bash
deeptutor run chat "Reply with a short greeting." --format json
```

这也使用配置的模型。检查是否成功响应并完成转动，而不仅仅是零退出代码或第一个流式传输事件。

完成结帐/环境、运行时主页、无凭据的提供程序/模型、通过的检查、Web URL 或 CLI 调用以及任何剩余的用户操作。将 `deeptutor stop` 包含在独立应用程序的同一主目录中。如果凭据或网络访问阻止验证，请明确说明未完成的步骤，而不是声明设置已完成。

## 6. 故障排除

使用以下方法调查用户的症状。根据证据选择检查；无需针对每个问题运行每个命令。

1. **识别正在运行的实例并重现症状。** 建立安装方法、安装版本或源代码提交、活动 Python 环境、运行时主目录和实际服务 URL。对于 Docker，区分容器路径/端口和主机路径/端口。询问失败的操作、预期结果、大致时间以及相关的近期更改。确认您的 CLI 检查目标与用户相同的实例、帐户和工作区；正常的第二次安装不会告诉您有关故障的信息。

2. **收集最小的有用证据。** 使用 `config show` 和 `doctor` 进行配置/准备，使用 `doctor --online` 进行真正的 LLM 请求，或使用 `doctor runtime` 进行轮次协调、会话存储和迁移预检。将 `--format json` 添加到任一医生模式。检查各个检查：顶级 `ok: true` 可以与 RAG 等可选故障共存。通过 LLM 探测并不能证明嵌入、搜索、工具或浏览器的连接有效。

3. **跨越其边界跟踪失败的操作。**从可见症状开始，确定操作进行到什么程度：浏览器 → API → 转向/功能 → 提供程序、工具或存储。检查浏览器控制台和网络错误是否存在 UI 问题，并按时间和 `request_id`、 `session_id` 或 `turn_id` （如果存在）关联服务器日志。对于分离式发射，请检查 `<runtime-home>/data/user/runtime/launcher.log`；应用程序日志通常位于 `data/user/logs/deeptutor.jsonl` 中，具体取决于日志记录设置。容器部署也可能需要容器输出。在共享之前阅读狭窄的相关摘录并删除凭据和私人内容。

4. **一次测试一个假设。** 将失败的操作减少到一个小的复制，并将工作路径与失败的路径进行比较。例如，成功的 CLI 转向和失败的 Web 转向会将注意力引向浏览器/API 路径，前提是两者都使用等效的设置和上下文。使用 `--help`、 `plugin info` 和签出的代码继续调查。根`AGENTS.md`映射架构；有用的起点包括 `deeptutor_cli/`、`deeptutor/api/`、`deeptutor/runtime/`、`deeptutor/capabilities/`、`deeptutor/services/` 和 `web/`。在得出结论之前将源与已安装的版本进行匹配。

5. **进行有针对性的修复并验证原始操作。** 保留现有数据和配置；避免将一揽子重新安装、重置或知识库重建作为探索性步骤。更改后重新运行用户的失败操作，而不仅仅是一般的运行状况检查。将观察结果与假设分开报告。如果未解决，请提供简明的交接：环境/版本、再现、预期行为与实际行为、相关的编辑错误、已尝试的检查以及下一个有用的调查。

## 实施与验证

- [deeptutor_cli/setup_config.py](../deeptutor_cli/setup_config.py)
- [deeptutor_cli/doctor.py](../deeptutor_cli/doctor.py)
- [测试/cli/test_agent_setup.py](../tests/cli/test_agent_setup.py)