# DeepTutor Vue 3 本地运行与部署

本文对应已经切换为默认前端的 `web-vue3/`。旧 `web/` 仅作为迁移期间的参考实现保留。Vue 版始终通过同源 `/api`、`/ws`、`/files` 与 FastAPI 通信，不需要也不应访问旧 Next.js 页面。

## 本地开发

按 [`AGENT_SETUP.md`](AGENT_SETUP.md) 准备 Python、Node.js 22、运行时目录和模型。PostgreSQL 的迁移与账号切换按 [`../deploy/postgres/CUTOVER.md`](../deploy/postgres/CUTOVER.md) 执行；前端不直接连接数据库。

分别启动后端和 Vite：

```bash
deeptutor serve --port 8001
```

```bash
cd web-vue3
npm ci
npm run dev
```

访问 `http://127.0.0.1:3783`。开发服务器只监听本机，默认代理到 `http://127.0.0.1:8001`；后端在其他地址时，在启动前设置 `DEEPTUTOR_API_ORIGIN=http://主机:端口`。

也可以使用统一入口：

```bash
deeptutor start                 # 后端 + Vue 生产静态服务器
deeptutor start --dev           # 后端 + Vite HMR
deeptutor start --detach        # 后台运行同一生产链
```

统一入口读取 `data/user/settings/*.json` 的端口配置，不把项目根目录 `.env` 当作设置来源。生产启动会按 Vue 源码指纹复用 `web-vue3/dist/`，输入变化时自动重建；wheel 环境使用打包的 `deeptutor_web/server.mjs` 和 `deeptutor_web/dist/`。

## 构建与验证

```bash
cd web-vue3
npm ci
npm run test:unit
npx playwright install chromium  # 首次浏览器测试时
npm run test:e2e
npm run test:server
npm run typecheck
npm run build
npm run routes:status
```

当前基线为 116 个 Vitest 测试、45 个 fixture 驱动的 Chromium 工作流、1 个生产静态服务器测试和 65/65 条完成路由。fixture 测试不需要数据库，但不能替代真实账号、数据库与模型验收。

单独运行生产静态服务器：

```bash
cd web-vue3
npm run build
FRONTEND_HOST=127.0.0.1 FRONTEND_PORT=3782 \
DEEPTUTOR_API_ORIGIN=http://127.0.0.1:8001 \
node server.mjs
```

`server.mjs` 只依赖 Node.js 标准库，支持 SPA 回退、静态缓存、Range 请求、API/文件流式代理和 WebSocket 隧道。启动器与 Docker 使用同一实现。`DEEPTUTOR_API_BASE_URL` 也可作为后端地址的兼容别名；`DEEPTUTOR_API_ORIGIN` 优先。

## 真实 PostgreSQL 验收

`playwright.acceptance.config.ts` 使用独立的 Vue 端口 3784 和验收后端端口 8011，避免接触默认 8001/3782/3783 服务。验收覆盖超级管理员创建管理员、管理员创建普通用户与学习者、角色跳转、普通用户自定义模型、学习者档案、真实笔记保存、图片上传和 Word 下载。

准备隔离环境：

1. 新建独立数据库，执行 `alembic upgrade head`，再依次执行 `deploy/postgres/init/01_app_role.sql` 与 `deploy/postgres/roles/02_auth_role.sql`。不要把验收数据库指向生产数据。
2. 用独立 `DEEPTUTOR_HOME` 初始化设置；需要真实模型时，只从已有设置复制测试提供方，并通过环境变量 `VUE3_ACCEPTANCE_MODEL_BASE_URL`、`VUE3_ACCEPTANCE_MODEL_API_KEY`、`VUE3_ACCEPTANCE_MODEL_NAME` 提供给验收脚本；普通用户会在浏览器中自行添加并应用该模型，无需管理员授权。
3. 设置 `DEEPTUTOR_STORAGE_BACKEND=postgres`、`DEEPTUTOR_ACCOUNT_BACKEND=postgres`、隔离的 `DATABASE_URL`/`AUTH_DATABASE_URL`、`AUTH_ENABLED=true`、超级管理员名和 bcrypt 密码哈希，然后运行 `deeptutor serve --host 127.0.0.1 --port 8011`。
4. 验收测试默认超级管理员名为 `vue3root`。用 `VUE3_ACCEPTANCE_ROOT_PASSWORD` 指定其密码；测试中的其他账号使用随机后缀。

运行：

```bash
cd web-vue3
npm run test:acceptance
```

在隔离模型已配置且允许一次小额真实请求时，额外验证真实 WebSocket 对话和刷新持久化：

```bash
VUE3_ACCEPTANCE_REAL_LLM=1 npm run test:acceptance
```

2026-11-09 已在隔离 PostgreSQL 环境通过上述两种验收；统一启动器和 development/production 两种 Docker 镜像也已通过启动烟测。外部 Whisper 插件未安装；其双席协议使用 fixture 验证，插件实际模型输出仍需在插件部署中检查。

## Docker 与 Compose

Dockerfile 的 `frontend-builder` 使用 Node.js 22 执行 `web-vue3/npm ci` 和生产构建。生产镜像只复制 `server.mjs` 与 `dist/`，前端运行不需要 Next.js 或前端 `node_modules`。`docker-compose.dev.yml` 挂载 `web-vue3/src`、静态资源和 Vite 配置，以 HMR 运行。

```bash
docker build -t deeptutor:vue3-local .
python scripts/docker_compose.py -f docker-compose.yml up -d
# 开发覆盖：
python scripts/docker_compose.py -f docker-compose.yml -f docker-compose.dev.yml up
```

容器入口从运行时 JSON 设置导出 `DEEPTUTOR_API_ORIGIN`，将 API、文件和 WebSocket 转发到容器内后端。公开部署通常只需公开前端端口；后端和 PostgreSQL 保持私有。升级不会修改数据库归属，回滚应恢复旧镜像或旧启动入口，而不是删除新用户数据。

## 云服务器 Nginx 静态部署

服务器保留 FastAPI、PostgreSQL 和 `data/`。使用 Node.js 22 在源码目录执行 `npm ci && npm run build`，Nginx 只提供 `web-vue3/dist/`。示例位于 [`../deploy/nginx/deeptutor-vue3.conf.example`](../deploy/nginx/deeptutor-vue3.conf.example)。

- `/api/`、`/ws`、`/files/` 必须保持原路径转发到 FastAPI；`/ws` 配置 Upgrade 头和较长读取超时，流式响应关闭代理缓冲。
- 其他路径回退到 `index.html`；`/assets/` 可长缓存，`index.html` 不应长缓存。
- 按实际域名、证书和 `dist` 绝对路径修改配置，并在启用前运行 `nginx -t`。
- 私有登录域与公开域名的 Host 必须分别由受信任代理承载。转发真实浏览器 Host 为 `X-Deeptutor-Frontend-Host`，并拒绝不匹配 `server_name` 的 Host；私有主机名配置到 `auth.private_login_hosts`。
- HTTPS 下设置 `cookie_secure=true`，复核登录 Cookie、深链接、上传下载、WebSocket 和一次性公网设备交接票据。

本地构建和隔离数据库验收不等同于云服务器验收。切换公开流量前仍需在真实双域名、TLS 与代理环境完成上述检查，并保留旧前端产物及回退入口。
