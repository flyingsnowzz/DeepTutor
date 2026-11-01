> **中文译本**：本文件由英文原文翻译；命令、路径、配置键、代码块和链接目标保持原样，如译文与实现存在歧义，以英文原文和当前代码为准。

# 可选的请求筛选（fastapi-guard）

[使用手册](README.md) · [相关指南](CONTAINERIZATION.md)

DeepTutor 可以通过 [fastapi-guard](https://github.com/Guard-Core/fastapi-guard) 屏蔽后端内部的 HTTP 请求。默认情况下它是关闭的**。当它关闭时，包永远不会被导入，中间件堆栈也不会改变。与任何新设置一样，`system.json` 在下次加载时将获得禁用的 `security_guard` 块及其默认值，并且格式错误的块将被默认值替换。

守卫是应用层的控件。它补充了边缘的反向智能体、WAF 或防火墙，并且当在没有这些端口的情况下到达后端端口时（例如 LAN 或隧道上发布的 `:8001`、 `deeptutor serve`），它仍能继续工作。

## 它的作用

对于它检查的每个 HTTP 请求，按照以下关注顺序：

- **IP 列表**：可选的允许列表（仅列出的地址通过）和可选的拒绝列表。
- **速率限制**：每个客户端地址一个滑动窗口，默认每60秒300个请求。
- **封禁列表**：触发重复攻击模式匹配的地址将被封禁一段时间。
- URL 路径、查询字符串和标头的 **攻击模式扫描**（XSS、SQL 注入、路径遍历等）。匹配返回 `400`。 `ssrf`类别被关闭，因为浏览器发送的页面地址为`Referer`，并且guard-core 4.4.0标记了其中的localhost和LAN地址，因此SSRF模式不会被屏蔽；当发动机修复发运时，应重新考虑这一点。

被拒绝的请求返回 `429`（速率限制）或 `403`（IP 列表、禁止）。该防护位于 `CORSMiddleware` 内部，因此这些响应仍然携带 CORS 标头，并且浏览器显示真实状态而不是不透明的 CORS 错误。

## 它不做什么

- 它从不读取请求主体。提示、文档和聊天消息都是自由文本，因此身体扫描已关闭 (`detection_scan_body=False`)。
- 它不筛选 WebSocket 握手 (`/ws`)，仅筛选 HTTP 请求。
- 它不使用Redis。计数器存在于每个后端进程中，因此当 `backend_workers` 大于 1 时，有效限制最多为 `rate_limit` 乘以工作线程数。
- 它不添加安全标头、处理 CORS 或发送遥测数据（`security_headers`、 `enable_cors` 和 `enable_agent` 均关闭）。

从 fastapi-guard 8.1.1 / Guard-core 4.4.0 开始（更高版本的引擎版本可能会更改它们），有两个值得了解的引擎行为：引擎默认 `exclude_paths` 中的路径（`/docs`、 `/redoc`、 `/openapi.json`、 `/openapi.yaml`、 `/favicon.ico`、 `/static` ) 仅跳过攻击模式扫描，速率限制和 IP 列表仍然适用于它们；列入白名单的地址会跳过攻击模式扫描和速率限制。

## 启用它

1. 在拥有服务器的环境中安装可选的防护依赖项：

   ```bash
   # Source checkout:
   python scripts/install_extras.py guard
   # Wheel environment with the server already installed:
   python -m pip install "deeptutor[guard]"
   ```

   在 Docker 中，在服务上设置 `DEEPTUTOR_EXTRAS: "guard"`，与其他附加功能相同（请参阅 [CONTAINERIZATION.md](CONTAINERIZATION.md)）。

2. 在 `data/user/settings/system.json` 中启用它：

   ```json
   {
     "security_guard": {
       "enabled": true,
       "rate_limit": 300,
       "rate_limit_window": 60,
       "trusted_proxies": ["127.0.0.1", "::1"],
       "exempt_ips": ["127.0.0.1", "::1"],
       "whitelist": [],
       "blacklist": []
     }
   }
   ```

   在 Docker 外部，可以将相同的键设置为进程环境覆盖： `DEEPTUTOR_GUARD_ENABLED`、 `DEEPTUTOR_GUARD_RATE_LIMIT`、 `DEEPTUTOR_GUARD_RATE_LIMIT_WINDOW`、 `DEEPTUTOR_GUARD_TRUSTED_PROXIES`、 `DEEPTUTOR_GUARD_EXEMPT_IPS`、 `DEEPTUTOR_GUARD_WHITELIST` 和 `DEEPTUTOR_GUARD_BLACKLIST` （逗号分隔的 IP 或 CIDR 范围）。 Docker 入口点忽略进程环境覆盖，因此在容器中使用 `system.json`。

3. 重新启动后端。

如果 `enabled` 为 true 并且 `fastapi-guard` 未安装，则后端拒绝启动并打印如何安装它。无效的 IP 或 CIDR 条目也会在启动时失败。

### 调整速率限制的大小

该限制计算来自一个客户端地址的**每个** HTTP 请求，包括前端的后台轮询（多个面板每 1 到 5 秒轮询一次）。每 60 秒 300 次为一些打开的面板留出了空间，而 fastapi-guard 8.1.1 在未配置任何内容时使用的每 60 秒 10 次在正常使用时会出现故障。 Next.js 前端本身为其静态资产提供服务，因此这些请求不会到达后端并且不被计算在内。

## 客户地址和智能体

守卫通过请求的套接字对等点来识别客户端。仅当对等方在 `trusted_proxies` 中列出时，它才相信 `X-Forwarded-For`（默认值：仅环回）。来自任何其他对等方的请求的 `X-Forwarded-For` 都会被忽略。

Uvicorn 还可以在应用程序看到它之前重写 `X-Forwarded-For` （和 `FORWARDED_ALLOW_IPS`）的对等点，这将让客户端选择自己的身份。每条 DeepTutor 发射路径都已经经过 `proxy_headers=False` / `--no-proxy-headers` （`deeptutor/api/run_server.py`、 `deeptutor_cli/main.py`、 `deeptutor/runtime/launcher.py`，都是 `Dockerfile` 发射线），因此守卫看到了真正的对等点。  `tests/api/test_security_guard.py` 通过 `uvicorn.Config(...).load()` 检查这一点。

如果您自己启动后端，请保留该标志：

```bash
python -m uvicorn deeptutor.api.main:app --host 0.0.0.0 --port 8001 --no-proxy-headers
```

如果后端前面有反向智能体，则将其地址添加到 `trusted_proxies`；否则每个客户端看起来都像智能体。警卫因此而禁止私人地址时会发出警告。

双堆栈绑定：使用guard-core 4.4.0，以 IPv4 映射形式报告的对等点（`::ffff:a.b.c.d`，如在双堆栈 `::` 绑定上）与 IPv4 `trusted_proxies` 条目不匹配，因此反向智能体的 `X-Forwarded-For` 被忽略，并且其所有客户端共享智能体的存储桶。默认启动路径绑定 `0.0.0.0`，不受影响。如果绑定 `::`，还列出每个智能体的映射形式，例如 `["10.0.0.0/8", "::ffff:10.0.0.0/104"]` （使用 Guard-core 4.4.0 检查，并由测试覆盖）。更高的 Guard-Core 版本可能不需要这个。

**捆绑的前端。** Next.js 智能体 ( `web/proxy.ts` ) 会从浏览器请求 ( `web/lib/backend-forward.ts` ) 中删除 `X-Forwarded-For` 和其他转发的标头，并且不会添加浏览器的地址。通过它到达后端的请求都从前端自己的地址（默认布局中的环回）到达，没有转发标头。一个共享限制会同时限制每个用户，因此 `exempt_ips` （默认 `127.0.0.1` 和 `::1`）使该地址免受速率限制。因此，通过前端，可以筛选请求的攻击模式和拒绝列表，但不限制速率。每个客户端的限制适用于直接到达后端的请求，或者通过设置 `X-Forwarded-For` 并在 `trusted_proxies` 中列出的反向智能体的请求（如果 `exempt_ips` 包含环回，则携带 `X-Forwarded-For` 的环回请求将被限制为转发客户端）。  `exempt_ips` 仅跳过速率限制：拒绝名单、禁令和攻击模式扫描仍然适用于列出的地址。守卫不禁止环回地址。

**捆绑前端的白名单。** 如果设置了 `whitelist`，则除非列出环回，否则前端流量（环回）将被拒绝。使用捆绑前端，将 `127.0.0.1` 和 `::1` 添加到 `whitelist`。然后，允许列表和拒绝列表仅管理直接后端访问，因为前端隐藏了浏览器地址。

## 实施与验证

- [deeptutor/api/security_guard.py](../deeptutor/api/security_guard.py)
- [测试/api/test_security_guard.py](../tests/api/test_security_guard.py)