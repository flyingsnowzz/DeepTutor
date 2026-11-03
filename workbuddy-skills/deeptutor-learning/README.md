# DeepTutor 全学段 AI 学习助手（WorkBuddy 技能包）

`deeptutor-learning` 把 DeepTutor 的学习能力包装成 WorkBuddy 技能：解题、精读、练习、错题、掌握度、复习、研究与教学媒体。技能是声明式门面，**不含脚本、不保存密钥与学习状态**；实际执行由 DeepTutor MCP 服务完成。

## 目录

```text
SKILL.md
references/   工具契约、长任务规则、学习流程、输出风格、安全边界、故障排查
templates/    学习计划 / 练习小结 / 掌握度报告模板
examples/     四类场景示例（供人工测试）
listing/      图标、展示图、隐私政策、用户协议、未成年人说明、支持与依赖说明
```

## 安装与联调

### 前置
- 可访问的 DeepTutor MCP 服务（本地 stdio 或云端 streamable HTTP）；
- Postgres + S3 兼容对象存储已在服务端就绪；
- 本地试用可用确定性运行器（`DEEPTUTOR_MCP_DETERMINISTIC=1`），无需模型密钥。

### 方式 A：本地 stdio（开发自测）
1. 启动服务：`deeptutor mcp serve --transport stdio`。源码运行时，`DEEPTUTOR_HOME` 必须指向项目根目录。
2. 按仓库 `workbuddy-skills/mcp-config/mcp-stdio.example.json` 把 `deeptutor` 条目合并进 `~/.workbuddy/mcp.json`，并把命令、数据库和对象存储配置替换为当前环境值。
3. 把本目录完整复制为 `~/.workbuddy/skills/deeptutor-learning`，在 WorkBuddy“专家·技能·连接器 → 技能 → 已安装”中确认已启用。
4. 重启或刷新 WorkBuddy，确认 MCP 连接指示灯和工具数量正常；输入 `/deeptutor-learning 出5道二次函数选择题，并加入我的练习库` 验证 Skill 触发与写库。

### 方式 B：云端 streamable HTTP（多账户）
1. 服务端启动：
   `deeptutor mcp serve --transport http --host 0.0.0.0 --port 8001`（TLS 由反向代理终结）。
2. 在浏览器打开托管登录页注册/登录，获取 access token（不要把密码或令牌发给对话）。
3. 配置 `mcp-config/mcp-http.example.json`：`url=https://<host>/mcp`，`Authorization: Bearer <access_token>`。
4. 未登录或令牌失效时，服务返回 401 与登录入口，按引导授权即可。
5. 技能安装方式同方式 A；用 `/deeptutor-learning 今天复习什么？` 验证 Skill 与远程工具。

### 验收
- `capabilities_list` 返回能力列表；
- 研究/可视化作业可提交并轮询成功，`artifact_get` 可取短期链接；
- 四条 E2E 场景见 `examples/` 与仓库 `docs-for-dev/workbuddy/e2e/`。

## 校验与打包

```bash
python scripts/release/validate_workbuddy_skill.py workbuddy-skills/deeptutor-learning
python scripts/release/build_workbuddy_skill_zip.py workbuddy-skills/deeptutor-learning dist/workbuddy-skills
python -m pytest tests/workbuddy_skills -q
```

## 边界
不提供作弊保证、不替代官方评分、不承诺提分；判分为形成性反馈。详见 `references/safety-and-boundaries.md` 与 `listing/`。
