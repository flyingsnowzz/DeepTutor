# MCP 错误码（T0 冻结版）

错误码面向外部宿主和用户，必须稳定、可翻译、可处理。内部异常信息不得原样透出。

## 1. HTTP / JSON-RPC / MCP 映射原则

| 场景 | HTTP 状态（HTTP transport） | MCP/业务错误码 | retryable |
| --- | --- | --- | --- |
| 未认证/token 缺失 | 401 | `UNAUTHORIZED` | false（重新授权后可重试） |
| token 失效 | 401 | `TOKEN_EXPIRED` | false（刷新后重试） |
| 无权限访问资源 | 403 | `FORBIDDEN` | false |
| 资源不存在或不属于当前用户 | 404 | `NOT_FOUND` | false |
| 参数错误 | 400 | `INVALID_ARGUMENT` | false |
| 缺少继续任务所需信息 | 200/409 | `NEEDS_INPUT` | true（reply 后继续） |
| 能力未启用/依赖缺失 | 503 | `CAPABILITY_UNAVAILABLE` | false |
| 频率超限 | 429 | `RATE_LIMITED` | true |
| 套餐额度不足 | 402/403 | `QUOTA_EXCEEDED` | false（升级/等待额度） |
| Job 状态冲突 | 409 | `JOB_CONFLICT` | false |
| Job 不存在 | 404 | `JOB_NOT_FOUND` | false |
| Job 失败 | 200 | `JOB_FAILED` | false |
| 等待补充输入超时 | 409 | `JOB_INPUT_TIMEOUT` | false |
| 上游模型/网络临时失败 | 502/503 | `UPSTREAM_UNAVAILABLE` | true |
| 内部错误 | 500 | `INTERNAL_ERROR` | true |

stdio 下没有 HTTP 状态，但仍返回同一业务错误码。

## 2. 错误响应格式

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "本月可用额度已用完。",
    "retryable": false,
    "details": {
      "quota": "quiz_generate",
      "limit": 100,
      "used": 100,
      "upgrade_hint": "plan_upgrade"
    }
  },
  "request_id": "req_01H..."
}
```

## 3. 错误码清单

| code | 含义 | 宿主处理建议 |
| --- | --- | --- |
| `UNAUTHORIZED` | 缺少或无法解析身份 | 引导登录/授权 |
| `TOKEN_EXPIRED` | 访问令牌过期 | 刷新或重新授权 |
| `FORBIDDEN` | 已登录但不允许访问 | 显示无权限，不重试 |
| `NOT_FOUND` | 资源不存在或无权访问 | 不暴露资源是否存在 |
| `INVALID_ARGUMENT` | 入参不符合 schema | 修改参数 |
| `UNSUPPORTED_CAPABILITY` | capability 不在白名单 | 更新宿主工具定义或提示不支持 |
| `CAPABILITY_UNAVAILABLE` | 模块 disabled/缺依赖 | 展示缺失能力，不调用 |
| `MISSING_DEPENDENCY` | Node/Manim/TTS/ffmpeg 等缺失 | 提示该能力暂不可用 |
| `NEEDS_INPUT` | Job 等待用户补充 | 调 reply，而不是重新 submit |
| `JOB_NOT_FOUND` | Job 不存在或不属于当前用户 | 刷新任务列表 |
| `JOB_CONFLICT` | 当前状态不允许该操作 | 重新 get 后处理 |
| `JOB_FAILED` | Job 已失败终态 | 展示安全错误；如需重试新建 job |
| `JOB_INPUT_TIMEOUT` | 等待补充输入超时 | 重新提交任务 |
| `RATE_LIMITED` | 请求频率过高 | 按 Retry-After/建议延迟重试 |
| `QUOTA_EXCEEDED` | 套餐/免费额度不足 | 升级、购买或等待额度重置 |
| `ARTIFACT_EXPIRED` | 产物签名 URL 已过期 | 重新 artifact_get |
| `ARTIFACT_TOO_LARGE` | 产物或输入超限 | 压缩、拆分或升级套餐 |
| `MATERIAL_PARSE_FAILED` | 上传材料解析失败 | 更换文件或重新上传 |
| `KB_NOT_READY` | 知识库未索引完成 | 等待后重试 |
| `UPSTREAM_UNAVAILABLE` | LLM/TTS/搜索/对象存储临时失败 | 指数退避重试 |
| `CONTENT_POLICY_BLOCKED` | 内容安全策略拒绝 | 修改请求，不盲目重试 |
| `INTERNAL_ERROR` | 未分类服务端错误 | 带 request_id 重试/反馈 |

## 4. 不允许透出的信息

- provider API key、cookie、Authorization header；
- 服务器绝对路径；
- Python traceback；
- SQL/数据库连接串；
- 其他用户的资源 ID；
- 内部环境变量；
- 对象存储私有 bucket 直连地址。

## 5. 日志与审计

错误日志至少记录：

- `request_id`
- `owner_user_id`（脱敏/哈希按合规要求）
- tool name
- capability
- job id（如有）
- error code
- retryable
- HTTP status
- latency_ms

密钥、答案内容和敏感材料是否入审计日志必须由隐私策略决定。
