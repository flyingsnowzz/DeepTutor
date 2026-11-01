> **中文译本**：本文件由英文原文翻译；命令、路径、配置键、代码块和链接目标保持原样，如译文与实现存在歧义，以英文原文和当前代码为准。

# DeepTutor 容器化

[手册](README.md) · [智能体设置](AGENT_SETUP.md) · [存储](DATA_STORAGE.md)

本文档涵盖从容器映像部署 DeepTutor：推荐的 `docker run` 路径、具有只读根文件系统的强化 rootless-Podman 路径、运行时配置、可选的 PocketBase sidecar 以及激发默认状态的安全说明。

对于 PyPI / 源安装，请参阅主要 [README.md](../README.md)。该文件仅与运行已发布的映像有关。

---

## 概述

已发布的 `ghcr.io/hkuds/deeptutor` 映像在 `supervisord` 内的单个容器内（位于 `python:3.11-slim` 之上）运行 FastAPI 后端 (`:8001`) 和 Next.js 前端 (`:3782`)。私有运行时树（容器内的 `/app/data`）保存设置、凭证、数据库、内存、知识库和日志。默认的内容工作区也驻留在此处，但可以单独安装在 `/workspace` 处。绑定挂载运行时树和任何单独的内容工作区，使两者都能在重新启动后幸存。

该映像的构建使其可以在三种部署形状下工作：

1. ** `docker run` ** — 简单的路径。 Rootful、可写 rootfs、在 `/app/data` 上单一绑定挂载。
2. ** `docker compose` ** ( `docker-compose.yml` ) — 同一图像加上 PocketBase sidecar 和 sandbox-runner sidecar。仍然是 rootful、可写的 rootfs。
3. ** `podman compose -f compose.yaml` ** — 硬化路径。无根（`userns_mode: keep-id`），只读 rootfs，tmpfs 代替可写系统目录，绑定挂载在 `./data` 上。

让 shape 3 发挥作用的架构变化是 URL 知识不再存在于前端包中。具体来说：

- 该捆绑包的构建没有 `NEXT_PUBLIC_API_BASE` 占位符，也没有构建输出的 `sed -i`。  `web/lib/api.ts` 将 `apiUrl` 和 `wsUrl` 导出为单行传递，因此浏览器通过前端 ( `:3782/api/...` ) 获取相对路径。
- `web/proxy.ts` 捕获 `/api/*` 和 `/ws/*` 并在请求时将它们重写为 `DEEPTUTOR_API_BASE_URL`。该环境变量在每次启动时由容器入口点设置，从 `data/user/settings/system.json` 读取。
- `start-frontend.sh` 设置 `PORT` / `HOSTNAME` 和 `exec` 的 `node /app/web/server.js`。捆绑包没有突变。
- `supervisord` 以 root (PID 1) 身份运行，并通过其每程序 `user=` 指令将每个程序（后端、前端）删除给非 root `deeptutor` 用户 (UID 1000)，因此应用程序进程保持非 root 状态。在主机上使用 `userns_mode: keep-id`，UID 映射到您的主机 UID；对于常规 `docker run`，它是容器内的普通非特权用户。

完整的安装指南如下。

---

## Docker（默认）

最简单的部署。 1个容器、1个私有数据卷、1个端口映射。

```bash
docker run --rm --name deeptutor \
  -p 127.0.0.1:3782:3782 \
  -v deeptutor-data:/app/data \
  ghcr.io/hkuds/deeptutor:latest
```

打开<http://127.0.0.1:3782>。容器在首次启动时创建 `/app/data/user/settings/*.json`；从 Web 设置页面配置模型提供程序。配置、API 密钥、日志、工作区文件、内存和知识库保留在 `deeptutor-data` 命名卷中。

### Unraid / NAS 绑定挂载 (PUID / PGID)

Unraid 和许多 NAS 模板将 appdata 作为主机用户拥有，该主机用户的 UID 不是 1000（通常是 `nobody:users` = 99:100，或指定共享用户）。这些主机还会在重新启动时恢复容器内的 `chown`。该镜像仍然将后端/前端下降到非 root `deeptutor` 用户；入口点重新映射该用户的 UID/GID 以匹配卷：

```bash
docker run --rm --name deeptutor \
  -e PUID=99 -e PGID=100 \
  -p 127.0.0.1:3782:3782 \
  -v /mnt/user/appdata/deeptutor:/app/data \
  ghcr.io/hkuds/deeptutor:latest
```

如果运行时用户仍然无法写入 `/app/data`，则入口点 **退出** 并显示所有者/模式消息，而不是启动并稍后报告 `Knowledge base not initialized (llamaindex)`。 Rootless Podman 会跳过重新映射（`CAP_SETUID` 不存在）并保留当前用户。  `PUID=0` / `PGID=0` 被拒绝，因此应用程序永远不会以 root 身份运行。

### 选择主机内容工作区

应用程序数据装载包含私有设置、凭据、数据库、内存和其他运行时状态。将其与智能体可以读取的**内容工作区**分开。要公开主机文件夹，请将其安装在稳定的 `/workspace` 路径并将部署锁定到该路径：

```bash
mkdir -p "$PWD/deeptutor-workspace/outputs"
docker run --rm --name deeptutor \
  -p 127.0.0.1:3782:3782 \
  -v deeptutor-data:/app/data \
  -v "$PWD/deeptutor-workspace:/workspace" \
  -e DEEPTUTOR_WORKSPACE_ROOT=/workspace \
  -e DEEPTUTOR_WORKSPACE_ALLOWED_ROOTS=/workspace \
  ghcr.io/hkuds/deeptutor:latest
```

对于提供的 Compose 文件：

```bash
DEEPTUTOR_WORKSPACE_HOST=/absolute/host/folder \
  python scripts/docker_compose.py -f docker-compose.yml up -d
```

帮助程序在 Compose 启动之前创建主机文件夹及其嵌套的 `outputs/` 目录，从而避免 root 拥有的绑定挂载。如果省略该变量，则使用 `./data/user/workspace`。容器始终会看到 `/workspace`，因此存储的设置和面向模型的路径在主机之间保持可移植性。这是一个启动/部署选项，在**设置 → 工作区**中显示为锁定。

使用 `docker-compose.yml`，沙箱运行器接收只读内容树以及 `/workspace/outputs` 的可写覆盖层；它不接收 `/app/data`、用户设置或凭据。因此，生成的程序读取选定的内容并仅写入回合范围的输出。单容器和无根 Podman 表单使用该容器中可用的最佳隔离后端，并报告工作区设置中的有效级别。

笔记：

- **仅需要发布 `3782`。** 浏览器仅与前端源 ( `:3782` ) 对话；所有 `/api/*` 和 `/ws/*` 流量均由 Next.js 中间件 ( `web/proxy.ts` ) 转发到 **容器内** 的 FastAPI 后端，该中间件在请求时读取 `DEEPTUTOR_API_BASE_URL` （默认为 `http://localhost:8001`）。您**不需要**需要向主机公开 `:8001` 才能使 UI 正常工作。发布 `:8001` ( `-p 127.0.0.1:8001:8001` ) 是可选的 - 仅在直接访问 API（curl、脚本）或调试时方便。
- **不同的主机端口：**更改每个 `-p host:container` 映射的左侧（例如 `-p 127.0.0.1:8088:3782`）。如果更改 `data/user/settings/system.json` （`backend_port`、 `frontend_port`）中的容器端端口，请重新启动容器并更新每个映射的右侧以匹配。
- **分离：**添加 `-d`，然后 `docker logs -f deeptutor` 跟随，`docker stop deeptutor` 停止，`docker rm deeptutor` 在重用名称之前。 `deeptutor-data` 卷在重新启动时保留私有运行时数据和默认内容工作区；单独安装的内容工作区保留在其主机路径中。

### 临时本地 Codex OAuth 桥

OpenAI Codex 将浏览器重定向到固定环回端口 `1455` 或 `1457`。默认容器网络与主机环回分开，因此仅在登录时将两个端口发布到 Web 前端。在启动临时桥​​接之前，两个主机端口都必须空闲。

对于 `docker run`，停止普通容器并使用两个额外的仅环回映射临时重新运行相同的映像和数据卷：

```bash
docker run --rm --name deeptutor \
  -p 127.0.0.1:3782:3782 \
  -p 127.0.0.1:1455:3782 \
  -p 127.0.0.1:1457:3782 \
  -v deeptutor-data:/app/data \
  ghcr.io/hkuds/deeptutor:latest
```

对于 Compose，将相同的临时覆盖添加到您通常使用的基本文件中：

```bash
# Source build with sidecars
python scripts/docker_compose.py \
  -f docker-compose.yml -f compose.codex-oauth.yaml \
  up -d --force-recreate deeptutor

# Pre-built GHCR image
python scripts/docker_compose.py \
  -f docker-compose.ghcr.yml -f compose.codex-oauth.yaml \
  up -d --force-recreate deeptutor

# Rootless Podman
podman compose -f compose.yaml -f compose.codex-oauth.yaml \
  up -d --force-recreate deeptutor
```

完成 **设置 → 模型 → OpenAI Codex → 使用 Codex 登录**。状态变为**已连接**后，停止临时`docker run`容器并返回到上面的正常命令。对于 Compose，重新运行相同的基本命令而不使用 `compose.codex-oauth.yaml`；保留 `--force-recreate deeptutor`，以便删除临时端口绑定。

释放主机端口`1455`和`1457`；凭证保留在持久 `/app/data/system` 树中。将每个回调映射绑定到 `127.0.0.1`，并且永远不要将其暴露在 LAN 或公共接口上 - 覆盖层在这两个端口上发布**整个**前端，而不仅仅是 `/auth/callback`。对于容器端前端端口不是 `3782` 的手动 `docker run`，更改右侧 `3782` 目标；  `scripts/docker_compose.py` 处理配置的自定义端口。对于单容器安装，如果模型生成的代码不得与机密共享容器信任边界，请将 `sandbox_allow_subprocess` 设置为 `false`。

### 一次性迁移：`docker-compose.ghcr.yml` 现在安装所有 `./data`

`docker-compose.ghcr.yml` 用于仅绑定挂载三个子树（`data/user`、 `data/memory`、 `data/knowledge_bases`），因此其他所有内容 — `data/system`（JWT 签名密钥、帐户、授权、审核日志、每个所有者 Codex 令牌）、`data/users`（每个用户工作区）、`data/partners` , `data/cli-apps` — 位于容器的可写层中，并在每次重新创建时被丢弃。它现在安装整个树，匹配 `docker-compose.yml` 和 `compose.yaml`。

**在升级后的第一个 `up -d` 之前**，将该状态复制到正在运行的容器中，或者空的主机目录会对其进行阴影，并且 DeepTutor 会重新生成身份验证密钥（将所有人注销）并以没有非管理员帐户的方式启动：

```bash
for tree in system users partners cli-apps; do
  docker cp "deeptutor:/app/data/$tree" "./data/$tree" 2>/dev/null || true
done
```

使用命名卷（`-v deeptutor-data:/app/data`）或源构建 Compose 文件的部署从未受到影响 - 它们已经保留了整个树。

### 远程/反向智能体部署

对于常见的**单容器**情况（此图），您根本不需要配置 API 库。浏览器针对服务于 UI 的任何源 (`https://deeptutor.example.com`) 发出相关的 `/api/*` 和 `/ws/*` 请求，容器内的 Next.js 中间件将它们转发到 `localhost:8001` 上的后端。只需将您的反向智能体/TLS 终止符指向已发布的 `:3782` 即可完成。

您只需为 **拆分部署** 设置 API 基础，其中后端在单独的容器中运行。在主机上编辑 `data/user/settings/system.json`（在 `deeptutor-data` 卷内 - `docker volume inspect deeptutor-data` 以查找其挂载点）并设置前端容器用于访问后端容器的网络内地址：

```json
{
  "next_public_api_base": "http://backend:8001"
}
```

入口点在每次启动时读取此内容，并导出 `DEEPTUTOR_API_BASE_URL` 为 `proxy.ts` （优先级： `next_public_api_base`，然后 `next_public_api_base_external`，然后 `http://localhost:8001`）。请注意，因为智能体是**服务器端**，所以 `DEEPTUTOR_API_BASE_URL` 是前端*服务器*用来到达后端的地址，而不是浏览器看到的 URL。  `public_api_base` 被接受为兼容性别名，并在保存时标准化为 `next_public_api_base_external`。

CORS 使用前端 **origins**，而不是 API URL。禁用身份验证后，DeepTutor 默认允许正常的 HTTP/HTTPS 浏览器来源。启用身份验证后，添加确切的前端来源：

```json
{
  "cors_origins": ["https://deeptutor.example.com"]
}
```

### 托管 LLM 提供商（Ollama / LM Studio / llama.cpp / vLLM / Lemonade）

在 Docker 内部，`localhost` 是容器本身，而不是您的主机。要访问主机上运行的模型服务，请使用主机网关（推荐）：

```bash
docker run --rm --name deeptutor \
  -p 127.0.0.1:3782:3782 -p 127.0.0.1:8001:8001 \
  --add-host=host.docker.internal:host-gateway \
  -v deeptutor-data:/app/data \
  ghcr.io/hkuds/deeptutor:latest
```

然后在 **设置 → 模型** 中，将提供程序基本 URL 指向 `host.docker.internal`：

- 奥拉玛法学硕士：`http://host.docker.internal:11434/v1`
- Ollama 嵌入：`http://host.docker.internal:11434/api/embed`
- LM工作室：`http://host.docker.internal:1234/v1`
- 骆驼.cpp: `http://host.docker.internal:8080/v1`
- 柠檬水：`http://host.docker.internal:13305/api/v1`

Docker Desktop (macOS/Windows) 通常解析 `host.docker.internal` 而不解析 `--add-host`。在Linux上，flag是可移植的方式。

**Linux 替代方案 — 主机网络：** 添加 `--network=host` 并删除 `-p` 标志。容器直接共享主机网络，因此打开 < http://127.0.0.1:3782 > （或 `system.json` 中的 `frontend_port`），并且可以使用普通的 localhost URL 访问主机服务。

在主机网络模式下，进程直接绑定在主机接口上（没有 `-p 127.0.0.1:` 前缀来限定它们的范围）。为了使它们远离 LAN，请设置 `BACKEND_HOST=127.0.0.1` 和 `FRONTEND_HOST=127.0.0.1` — 它们会覆盖 uvicorn 的 `--host` 和 Next.js 的 `HOSTNAME` （两者都默认为 `0.0.0.0`）。仅将它们与 `--network=host` 一起使用：在桥接模式下，绑定到环回会中断已发布的 `-p` 端口转发。

---

## Podman / 无根 / 只读 rootfs

对于想要最强默认状态（无根、具有只读根文件系统）的用户来说，`compose.yaml` 是受支持的起点。它提取相同的 `ghcr.io/hkuds/deeptutor:latest` 映像，并依赖于入口点 chown +supervisord 的每个程序权限下降、URL 转发 `proxy.ts` 和主机端绑定安装来使其全部正常工作。

```bash
cp .env.example .env       # then edit if needed
podman compose -f compose.yaml up -d
podman compose -f compose.yaml ps
podman compose -f compose.yaml logs -f deeptutor
```

验证 rootless 是否处于活动状态（`podman info | grep -i rootless` 应报告 `true`）。

`compose.yaml` 的作用及其原因：

- ** 每个服务上的 `read_only: true`。** 容器的 rootfs 是只读的。唯一可写的表面是每个服务列出的 `tmpfs:` 挂载以及绑定挂载的 `./data` 和内容工作空间目录。
- ** `userns_mode: keep-id` .** 使用运行时的 keep-id 用户命名空间。检查目标主机上的实际映射；不要假设容器 UID 0 或 UID 1000 对于每个主机帐户都有相同的映射。 `:U` 挂载选项可调整容器映射的所有权，并可以更改主机目录所有权。使用专用数据目录并验证写入访问权限。
- ** `tmpfs:` 挂载运行时期望写入的系统目录。** `/tmp` (Python/Node 暂存)、`/run` 和 `/var/run` (pidfiles)、 `/var/log`、 `/root`、 `/home`。尺寸故意大方；修剪以适应口味。
- **没有命名卷。** Podman 使用用户映射的根（UID 100000）自动创建命名卷，因此在第一次 JSON 写入时 755 个权限 + 错误的所有者 = `PermissionError`。绑定安装在您拥有的主机目录上，可以干净地工作。
- **仅环回端口绑定。** 每个 `ports:` 条目上都有 `127.0.0.1:` 前缀。删除要在所有接口上公开的前缀。
- **没有沙箱运行器 sidecar。** `docker-compose.yml` 形状包括一个强化的 sidecar，它在权限最低的容器中运行不受信任的模型生成的代码。 podman 形状则不然 — 主应用程序回退到 `bwrap` （Linux，如果安装在映像中）或由 `system.json` 中的 `sandbox_allow_subprocess` 控制的受限子进程后端。

### 跑出`compose.yaml`

`compose.yaml`是一个起点，而不是唯一的形状。如果您想直接驱动 `podman run`，则同样的不变量适用：

```bash
mkdir -p data/user/settings
# Create defaults only when no settings exist; preserve existing configuration.
if [ ! -f data/user/settings/system.json ]; then
  printf '{}\n' > data/user/settings/system.json
fi

podman run --rm -d --name deeptutor \
  -p 127.0.0.1:8001:8001 \
  -p 127.0.0.1:3782:3782 \
  -v $(pwd)/data:/app/data:U \
  --read-only \
  --tmpfs /tmp:size=512m,mode=1777 \
  --tmpfs /run:size=32m,mode=0755 \
  --tmpfs /var/run:size=8m,mode=0755 \
  --tmpfs /var/log:size=64m,mode=0755 \
  --tmpfs /root:size=16m,mode=0700 \
  --tmpfs /home:size=16m,mode=0755 \
  --userns=keep-id \
  ghcr.io/hkuds/deeptutor:latest
```

容器启动后，后端和前端始终以非根 `deeptutor` 用户（UID 1000）运行 - `podman exec deeptutor ps -o user,pid,comm` 将 `uvicorn` / `node` 子级显示为 `deeptutor`。  `supervisord` 本身（PID 1）以运行时启动它的任何 UID 运行：有根 Docker/Podman 下的 root，或无根 podman + `userns_mode: keep-id` 下的主机用户。

### 监督pid文件

`[supervisord]` 部分**没有 `user=` 指令**，因此supervisord 以 PID 1 的 UID 运行，并且永远不会尝试放弃自己的特权；只有其子程序通过每个程序 `user=` 指令落入 `deeptutor`。在这里固定 `user=root` （早期的设计）破坏了 rootless keep-id，其中 PID 1 是非 root 主机用户并且缺少 `CAP_SETUID`：supervisord 拒绝放弃特权并在启动时以 `Can't drop privilege as nonroot user` 退出（请参阅supervisord 的 `options.py`）。

pidfile写入**`/tmp/supervisord.pid`**。  在上面的每个运行配置中， `/tmp` 是 `mode=1777` （全局可写），因此无论 PID 1 是 root 还是主机 UID，也无论谁拥有 `/var/run`，pidfile 都是可写的。早期版本将 pidfile 指向 root 拥有的 `/var/run/supervisord.pid`；在无根 keep-id 下，非根 PID 1 无法写入它，并在每次启动时记录一个化妆品 `CRIT could not write pidfile`。将其放入 `/tmp` 中可以完全消除对 `/var/run` 所有者和模式的依赖。

---

## 运行时配置

几乎所有您调整的内容都位于数据树内的 `data/user/settings/` 下。容器入口点在每次启动时取消设置相关环境变量的列表（`BACKEND_PORT`、 `FRONTEND_PORT`、 `NEXT_PUBLIC_API_BASE`、 `NEXT_PUBLIC_API_BASE_EXTERNAL`、 `AUTH_ENABLED`、 `POCKETBASE_URL` 等），并从 JSON 重新导出值。因此：编辑 JSON，重新启动，不要尝试使用 compose 环境变量来驱动它们。

| 文件 | 目的 |
|:---|:---|
| `system.json` | 后端/前端端口、公共 API 库、CORS、SSL 验证、附件目录 |
| `auth.json` | 可选的身份验证切换、用户名、密码哈希、令牌/cookie 设置 |
| `integrations.json` | 可选的 PocketBase 和 Sidecar 集成设置 |
| `model_catalog.json` | LLM、嵌入和搜索提供商简介； API 密钥；活跃模型 |
| `interface.json` | UI语言/主题/侧边栏首选项 |
| `main.yaml` | 运行时行为默认值和路径注入 |
| `agents.yaml` | 能力/工具温度和令牌设置 |

与全新安装最相关的两个设置：

- ** `system.json` → `next_public_api_base` **（网络内）和 ** `next_public_api_base_external` **（云/外部覆盖）。入口点读取这些并导出 `DEEPTUTOR_API_BASE_URL`，`web/proxy.ts` 会使用该 `DEEPTUTOR_API_BASE_URL`。  `public_api_base` 被接受为兼容性别名，并在保存时标准化为 `next_public_api_base_external`。
- ** `system.json` → `backend_port` / `frontend_port` **。 Supervisor 在容器内绑定的容器端口。如果更改这些，请更新每个 `-p host:container` 映射的右侧（或 `compose.yaml` 读取的 `HOST_PORT_*` 环境变量）以匹配。

项目根 `.env` 文件作为应用程序配置被有意忽略。 Web **设置**页面是 JSON/YAML 文件的推荐编辑器；每个部分的深层链接都位于页面侧边栏中。

---

## 袖珍底座

PocketBase 是一个可选的身份验证+存储 sidecar。通过在 `data/user/settings/integrations.json` 中将 `integrations.pocketbase_url` 设置为 `http://pocketbase:8090` 并将 `pocketbase` 服务与主 `deeptutor` 服务放在一起来激活它。运行时，主应用程序将用户帐户和会话存储在 PocketBase 中，而不是退回到 SQLite 单用户布局。

`compose.yaml` 中的 `pocketbase` 服务（以及 `docker-compose.yml` 中更正后的挂载）绑定挂载 `./data` 的三个子目录（`/pb_data`、`/pb_public`、`/pb_hooks`），与上游 `ghcr.io/muchobien/pocketbase:latest` 映像的入口点相匹配，该入口点使用绝对路径。早期的 `docker-compose.yml` 示例安装了 `/pb/pb_data`，并在首次使用 `mkdir /pb_data: read-only file system` 启动时崩溃；这个 PR 解决了这个问题。

PocketBase 保持单用户集成 — 对于多用户部署，请将 `integrations.pocketbase_url` 留空，除非您已连接外部用户存储。

---

## 故障排除

** 容器启动时的 `CRIT could not write pidfile /var/run/supervisord.pid`。** 仅适用于 pidfile 移至 `/tmp/supervisord.pid` 之前构建的映像（`mode=1777`，始终可写）；当前图像不会发出它。无论哪种方式，受监督的孩子都会出现——队伍总是装饰性的。修复：拉取当前映像（或者，在旧映像上，将 `/var/run` tmpfs 设置为 `mode=1777`）。

**页面加载，但设置显示“后端无法访问”。** UI 通过容器内智能体（而不是主机端口）到达后端，因此这几乎总是无法启动的后端（检查 `docker logs deeptutor` 中的 `[program:backend]` 行）或拆分部署中的错误 `DEEPTUTOR_API_BASE_URL` — **不是**缺少 `:8001` 主机映射（UI 不需要）。

** podman 主机上的 `Cannot connect to the Docker daemon`。** 运行 `systemctl --user start podman.socket`（无根）或为 `docker-compose` CLI 设置 `DOCKER_HOST=unix:///run/user/$UID/podman/podman.sock` 以使用 podman 套接字。

** 在命名卷下第一次写入 JSON 时为 `Permission denied`。** 这是用户映射的根本问题；切换到您拥有的主机目录上的绑定安装，或在卷安装上使用 `:U`。

** Unraid 上的 `Data directory is not writable` / `Knowledge base not initialized (llamaindex)`。** 该应用程序以非 root `deeptutor` 用户身份运行。将 `PUID` / `PGID` 设置为绑定挂载的主机所有者（请参阅[Unraid / NAS 绑定挂载](#unraid--nas-bind-mounts-puid--pgid)）。不要以 root 身份运行容器来解决此问题。

** 新镜像上出现 `sed -i` 错误。** 不应该有任何错误 — 运行时不再改变包。 URL 在请求时转发。如果您看到一个，则您可能使用的是较旧的图像；再次拉动`ghcr.io/hkuds/deeptutor:latest`。

**设置页面不接受API基础URL。** 在主机上打开`data/user/settings/system.json`并直接设置`next_public_api_base_external`。页面 UI 连接到 `public_api_base`（旧别名），旧字段将在保存时重新规范化。

---

## 安全说明

- 在启动 `supervisord` 之前，该映像会向非 root `deeptutor` 用户（默认情况下 UID 1000，或 root Docker 下的 `PUID` / `PGID`）授予权限。以 root 身份运行的任何内容都是入口点、`/app/data` 的尝试 chown 和 env-var 导出。应用程序进程本身永远不会保持根状态。
- `read_only: true` 加上 `tmpfs:` 用于预期的可写系统目录意味着容器的根文件系统在运行时是不可变的。尝试在列出的 tmpfs 路径或绑定安装的 `./data` 树之外写入的进程将会失败。
- 主机上的 `userns_mode: keep-id` 意味着容器逃逸以主机用户的权限登陆，而不是 root。
- 沙箱运行器 sidecar（在 `docker-compose.yml` 中，**不是**在 `compose.yaml` 中）是不受信任的模型生成代码的最强姿势：沙箱逃逸落在没有应用程序机密的剥离的非特权容器中，而不是在主应用程序中。 podman 形状将其替换为无根 podman 形状；主应用程序回退到 `bwrap` 或由 `sandbox_allow_subprocess` 控制的受限子进程后端。
- Auth ( `data/user/settings/auth.json` → `auth_enabled = true` ) 通过 `dt_token` cookie 控制 `/api/*` 和 `/ws/*`。  `web/proxy.ts` 读取 `DEEPTUTOR_AUTH_ENABLED`（每次启动时由入口点导出）来决定是否需要 cookie。
- CORS 使用前端 **origins**，而不是 API URL。启用身份验证后，将 `system.json` 中的 `cors_origins` 设置为部署所服务的确切前端源。
- 可选的请求筛选（速率限制、IP 允许/拒绝列表、攻击模式扫描）可通过 `system.json` 中的 `security_guard` 和 `guard` 附加 ( `DEEPTUTOR_EXTRAS: "guard"` ) 进行。默认关闭；参见 [SECURITY_GUARD.md](SECURITY_GUARD.md)。

## 实施与验证

- [Dockerfile](../Dockerfile)
- [docker-compose.yml](../docker-compose.yml)
- [docker-compose.ghcr.yml](../docker-compose.ghcr.yml)
- [compose.yaml](../compose.yaml)
- [脚本/docker_compose.py](../scripts/docker_compose.py)
- [测试/脚本/test_docker_compose.py](../tests/scripts/test_docker_compose.py)