# DeepTutor MCP 工具契约（T0 冻结版）

> 状态：T0 draft/frozen for T1 implementation。  
> 适用对象：WorkBuddy、千问办公、豆包等外部宿主通过 MCP 使用 DeepTutor。DeepTutor 自有 App/Web/SDK 不走 MCP。  
> 约定：本文件是 T1/T2 的工具名、入参、出参和裁剪规则基线；若实现必须破坏兼容，应先更新本文件和验收矩阵。

## 1. 通用约定

### 1.1 调用通道

- T1：stdio。
- T2：streamable HTTP `/mcp` 为主，stdio 保留；SSE 仅在宿主明确需要时实现。
- MCP 是协议适配层，不实现第二套教学逻辑。
- 所有工具最终调用 DeepTutor 应用服务、Capability、LearningService、Job/Artifact 服务。

### 1.2 身份与隔离

服务端从认证上下文注入，禁止客户端伪造：

```json
{
  "user_id": "server-resolved",
  "workspace_id": "server-resolved",
  "owner_user_id": "server-resolved",
  "plan": "free|student|pro",
  "request_id": "server-generated"
}
```

个人数据表和资源查询必须带 `owner_user_id`。客户端传入的 `user_id`、workspace、角色、管理员标记一律忽略。

### 1.3 通用字段限制

| 字段 | 限制（T0 基线） |
| --- | --- |
| `capability` | 服务端白名单枚举 |
| `input` | 最大 64 KB；长材料应先上传或传资源引用 |
| `knowledge_bases[]` | 最多 10 个，每个 ≤ 128 字符 |
| `idempotency_key` | 1–128 字符；同一 owner 内唯一 |
| `artifact_ref` | 服务端签发的不透明 ID，最大 256 字符 |
| `cursor` | 不透明字符串，最大 512 字符 |
| 文本输出 | 默认 8 KB，最高 32 KB；大内容走 artifact |
| 列表 `limit` | 默认 20，最大 100 |

### 1.4 通用响应包裹

同步工具：

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "request_id": "req_..."
}
```

失败：

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "本月练习生成额度已用完。",
    "retryable": false,
    "details": {}
  },
  "request_id": "req_..."
}
```

MCP 原生错误与业务错误的映射见 [`error-codes.md`](./error-codes.md)。

## 2. Job 工具

### 2.1 `capabilities_list`

列出当前账户可用能力和模块就绪状态。

#### Input Schema

```json
{
  "$id": "capabilities_list.input",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "include_dependencies": { "type": "boolean", "default": true },
    "locale": { "type": "string", "enum": ["zh", "en"], "default": "zh" }
  }
}
```

#### Output Schema

```json
{
  "type": "object",
  "required": ["capabilities"],
  "properties": {
    "capabilities": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "status", "supports_jobs"],
        "properties": {
          "name": { "type": "string" },
          "display_name": { "type": "string" },
          "status": { "type": "string", "enum": ["ready", "disabled", "missing_dependency", "quota_blocked"] },
          "supports_jobs": { "type": "boolean" },
          "missing_dependencies": { "type": "array", "items": { "type": "string" } },
          "estimated_duration_sec": { "type": ["integer", "null"], "minimum": 1 },
          "cost_hint": { "type": ["object", "null"] }
        }
      }
    }
  }
}
```

### 2.2 `capability_run_submit`

提交一次能力作业。研究、解题、出题、判分、音频、视频、动画必须走 Job，不做阻塞式同步调用。

#### Input Schema

```json
{
  "$id": "capability_run_submit.input",
  "type": "object",
  "additionalProperties": false,
  "required": ["capability", "input"],
  "properties": {
    "capability": {
      "type": "string",
      "enum": [
        "deep_research",
        "visualize",
        "deep_question",
        "deep_solve",
        "quiz_judge",
        "audio_overview",
        "video_lesson",
        "math_animator",
        "mastery_path_generate"
      ]
    },
    "input": {
      "type": "object",
      "additionalProperties": true,
      "required": ["prompt"],
      "properties": {
        "prompt": { "type": "string", "minLength": 1, "maxLength": 16000 },
        "knowledge_bases": { "type": "array", "items": { "type": "string" }, "maxItems": 10 },
        "material_refs": { "type": "array", "items": { "type": "string" }, "maxItems": 20 },
        "config": { "type": "object", "additionalProperties": true }
      }
    },
    "idempotency_key": { "type": "string", "minLength": 1, "maxLength": 128 },
    "locale": { "type": "string", "enum": ["zh", "en"], "default": "zh" }
  }
}
```

#### Output Schema

```json
{
  "type": "object",
  "required": ["job_id", "session_id", "status"],
  "properties": {
    "job_id": { "type": "string" },
    "session_id": { "type": "string" },
    "status": { "type": "string", "enum": ["queued", "running", "needs_input"] },
    "poll_after_ms": { "type": "integer", "minimum": 500 },
    "missing_fields": { "type": "array", "items": { "type": "string" } }
  }
}
```

重复提交规则：同一 `(owner_user_id,idempotency_key)` 返回同一个 job，不重复扣费、不重复计分。

### 2.3 `capability_job_get`

#### Input Schema

```json
{
  "$id": "capability_job_get.input",
  "type": "object",
  "additionalProperties": false,
  "required": ["job_id"],
  "properties": {
    "job_id": { "type": "string", "minLength": 1, "maxLength": 128 },
    "include_events": { "type": "boolean", "default": false }
  }
}
```

#### Output Schema

```json
{
  "type": "object",
  "required": ["job_id", "status"],
  "properties": {
    "job_id": { "type": "string" },
    "status": { "type": "string", "enum": ["queued", "running", "needs_input", "succeeded", "failed", "canceled"] },
    "progress": {
      "type": "object",
      "properties": {
        "stage": { "type": ["string", "null"] },
        "percent": { "type": "number", "minimum": 0, "maximum": 100 },
        "message": { "type": ["string", "null"] }
      }
    },
    "result": { "type": ["object", "null"] },
    "artifacts": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["artifact_ref", "kind", "mime_type"],
        "properties": {
          "artifact_ref": { "type": "string" },
          "kind": { "type": "string" },
          "mime_type": { "type": "string" },
          "title": { "type": "string" }
        }
      }
    },
    "needs_input": {
      "type": ["object", "null"],
      "properties": {
        "fields": { "type": "array", "items": { "type": "string" } },
        "prompt": { "type": "string" }
      }
    },
    "error": { "type": ["object", "null"] }
  }
}
```

### 2.4 `capability_job_cancel`

```json
{
  "$id": "capability_job_cancel.input",
  "type": "object",
  "additionalProperties": false,
  "required": ["job_id"],
  "properties": {
    "job_id": { "type": "string", "minLength": 1, "maxLength": 128 },
    "reason": { "type": "string", "maxLength": 500 }
  }
}
```

返回：`{ "job_id": "string", "status": "canceled|canceling|terminal" }`。

### 2.5 `capability_job_reply`

用于 `needs_input` 状态下补充信息，不用于普通聊天。

```json
{
  "$id": "capability_job_reply.input",
  "type": "object",
  "additionalProperties": false,
  "required": ["job_id", "reply"],
  "properties": {
    "job_id": { "type": "string" },
    "reply": { "type": "object", "additionalProperties": true },
    "client_command_id": { "type": "string" }
  }
}
```

### 2.6 `artifact_get`

```json
{
  "$id": "artifact_get.input",
  "type": "object",
  "additionalProperties": false,
  "required": ["artifact_ref"],
  "properties": {
    "artifact_ref": { "type": "string", "minLength": 1, "maxLength": 256 },
    "disposition": { "type": "string", "enum": ["url", "inline", "download"], "default": "url" }
  }
}
```

返回：

```json
{
  "type": "object",
  "required": ["url", "expires_in_sec"],
  "properties": {
    "url": { "type": "string", "format": "uri" },
    "expires_in_sec": { "type": "integer", "minimum": 30 },
    "mime_type": { "type": "string" },
    "filename": { "type": "string" }
  }
}
```

## 3. 同步学习状态工具

同步工具只允许短查询、即时判分和幂等复习提交；不得触发长时间生成。

### 3.1 分页 Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 20 },
    "cursor": { "type": ["string", "null"], "maxLength": 512 }
  }
}
```

### 3.2 Practice 工具

| 工具 | 入参摘要 | 出参摘要 |
| --- | --- | --- |
| `practice_summary_get` | 无业务入参，身份注入 | `total_due`、`overdue`、`due_today`、`reviewed_today`、`next_due_at` |
| `practice_queue_list` | 分页、`due_before?`、`filter=all|due|wrong|bookmarked|uncategorized` | `entries[]`、`next_cursor` |
| `practice_question_get` | `entry_id` | 题干、选项、题型、来源、知识点 |
| `practice_answer_check` | `entry_id`、`answer` | `is_correct`、客观反馈、知识点、证据 ID |
| `practice_review_submit` | `entry_id`、`rating`、`request_id` | 复习状态、`next_due_at`，按 request_id 幂等 |
| `practice_entries_list` | 分页、过滤、书签状态 | 题目条目列表 |
| `practice_entry_bookmark` | `entry_id`、`starred` | 当前收藏状态 |

`practice_review_submit.rating`：

```json
{ "enum": ["again", "hard", "good", "easy"] }
```

### 3.3 Mastery 工具

| 工具 | 入参摘要 | 出参摘要 |
| --- | --- | --- |
| `mastery_paths_list` | 分页、状态过滤 | path 列表、阶段、更新时间 |
| `mastery_map_get` | `path_id` | 知识点节点、前置/后继关系、掌握度、证据数 |
| `mastery_objective_get` | `path_id`、`knowledge_point_id` | 单知识点掌握度、证据、推荐下一步 |
| `review_tasks_list` | 分页、`due_before?` | 到期复习任务、类型、关联资源 |

所有 `entry_id`、`path_id`、`knowledge_point_id` 必须做 owner 校验；不存在和无权访问返回同一形态的 `NOT_FOUND`，避免资源枚举。

## 4. T1/T2 开放节奏

| 工具/能力 | T1 | T2 | T3 | T4/T5 |
| --- | --- | --- | --- | --- |
| `capabilities_list` | ✅ | ✅ | ✅ | ✅ |
| job 原语 + `artifact_get` | ✅ | ✅ | ✅ | ✅ |
| `deep_research` / `visualize` | ✅ | ✅ | ✅ | ✅ |
| `quiz_generate_*`（P1 末） | ✅ | ✅ | ✅ | ✅ |
| practice/mastery 同步工具 | 仅本地测试表 | ✅ | ✅ | ✅ |
| `deep_solve` / `quiz_judge` / `audio_overview` | — | ✅ | ✅ | ✅ |
| `immersive_reading` 实时会话 | — | — | ✅ | ✅ |
| `video_lesson` / `math_animator` / Hook | — | — | ✅ | ✅ |
| WorkBuddy Skill 包 | 草稿 | 可联调 | 可联调 | T5 上架 |

## 5. 明确不注册的工具

- 裸 `chat`：避免外部宿主出现第二个 agent loop。
- `exec`、shell、任意命令执行。
- 任意文件路径读写、服务器绝对路径读取。
- provider/model credential 管理、系统设置、MCP client 配置管理。
- 通用用户管理、组织管理、团队报表。
- 未经白名单的 Capability 名称。

