> **中文译本**：本文件由英文原文翻译；命令、路径、配置键、代码块和链接目标保持原样，如译文与实现存在歧义，以英文原文和当前代码为准。

# 测试和验证

[使用手册](README.md) · [开发](DEVELOPMENT.md) · [模块](MODULES.md#validation)

使用存储库的配置工具和[智能体设置](AGENT_SETUP.md) 中的环境。在开发期间运行有针对性的检查，并在发布之前对受影响的项目进行控制。仅文档更改不需要付费模型调用或完整的渲染工作负载。

## 按变更选择支票

| 改变 | 最低限度的有用证据 |
| --- | --- |
| 文档和 CLI 示例 | 链接/锚点、CLI 文档合同、命令帮助、无陈旧路径 |
| Python 领域逻辑 | 集中 pytest 重现；拉夫；相关进口边界 |
| API 或回合事件 | 请求/授权测试、生成的合约检查、持久性/重放测试、消费者测试 |
| 前端行为 | 类型检查、重点 Node/Vitest 测试、依赖性检查；交互/布局的浏览器验证 |
| 模块所有权/依赖项 | 生成的需求、模块隔离、轮子生命周期烟雾 |
| 插件工作者或打包页面 | 清单、运行时/生命周期和 API 测试、参考示例 Wheel |
| 解析/子进程代码 | 真实子进程成功/错误/超时/取消；相关平台检查 |
| 提供商/模型集成 | 模拟合约测试加上需要时显式配置的真实提供商探针 |

## Python

```bash
python -m pytest tests/cli/test_docs_contract.py tests/scripts/test_docker_compose.py
python -m pytest tests/app tests/runtime/coordination
python -m pytest tests/plugins tests/api/test_plugins_router.py
python -m ruff check .
python -m ruff format --check .
lint-imports
python scripts/check_architecture.py
python scripts/sync_module_requirements.py --check
python scripts/check_repo_hygiene.py
```

这些是单独的入口点；选择相关套件，而不是假设第一个命令涵盖所有更改。完整的 Python 套件是 `python -m pytest tests deeptutor/learning/tests`。某些集成案例需要 Redis、可选引擎或平台可执行文件等固定装置。阅读跳过条件并准确报告跳过的检查。

`check_repo_hygiene.py` 检查跟踪路径。更严格的 `check_workspace_hygiene.py` 还需要完全干净的签出，因此在提交后运行它，而不是将预期的编辑解释为测试失败。

## Web 和生成的合同

来自 `web/`：

```bash
npm run typecheck
npm run architecture:check
npm run test:node
npm run test:unit
npm run lint
npm run i18n:check
npm run contracts:check
```

`npm run check:fast` 运行上述确定性检查；  `npm run check` 添加了生产构建和路线预算。更改后端架构后使用 `npm run contracts:generate`，然后检查并提交生成的差异。生成器拥有 [ `web/contracts/` ](../web/contracts/) 并调用 [Python 导出脚本](../scripts/export_frontend_contracts.py)。

渲染组件测试使用 Vitest 和测试库。节点测试涵盖纯合约和状态逻辑。剧作家 `npm run audit` 期望 `WEB_BASE_URL` 上有一个正在运行的前端；关键项目和多人项目在 [`playwright.config.ts`](../web/playwright.config.ts) 中有单独的夹具要求。不要针对学习者的唯一数据副本运行浏览器突变。

## 模块、引擎和可选集成

按照[模块→验证](MODULES.md#validation)进行一次性轮子安装、卸载/重新安装和保留数据检查。不要使用开发解释器来测试包删除。

实验性 TypeScript 引擎在 [ `packages/chat-engine/` ](../packages/chat-engine/) 下有自己的 `npm test`，以及 Python 桥和应用程序兼容性测试。规范矩阵位于 [ `tests.yml` ](../.github/workflows/tests.yml) 和 [ `modules.yml` ](../.github/workflows/modules.yml) 中。

`deeptutor doctor --online`执行真实模型请求。提示缓存、视频渲染和多工作人员验收测试可能需要显式选择加入变量。说明实际环境和进行的验证；历史测试计数和模拟提供程序不会建立当前的生产行为。

## 审查文档更改

检查每个文件的相对链接，而不是存储库根目录的相对链接。移动指南时搜索 README 翻译、CLI 帮助、UI 设置提示和测试装置。保持源链接没有脆弱的行号。使用已安装的 CLI 的 `--help` 和权威清单/设置来验证命令和默认值。将本地工件和秘密保留在提交之外。