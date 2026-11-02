# 故障排查（对用户的说法）

只呈现“怎么办”，不要输出内部错误码堆栈。下表供技能自己判断。

| 现象 | 工具信号 | 对用户的引导 |
| --- | --- | --- |
| 未登录/令牌失效 | HTTP 401 `UNAUTHENTICATED` / `INVALID_TOKEN` | “需要先登录 DeepTutor 授权，点这里登录后我继续：<登录入口>。”不要让用户把密码发给你。 |
| 刷新令牌过期 | refresh 401 | 引导重新登录；说明学习记录与账户绑定不会丢。 |
| MCP 连不上 | 网络/5xx/超时 | “学习服务暂时连不上，我稍后再试一次。”retryable 错误可重试 1 次；仍失败建议稍后再试。 |
| 能力缺依赖 | `CAPABILITY_UNAVAILABLE`(503)，details.missing_dependencies | “视频/动画渲染在当前服务环境还没就绪（缺 X）。可以先用文字讲解/可视化代替。”不要承诺时间点。 |
| 额度用完 | `QUOTA_EXCEEDED`(429)，details.upgrade_url | “今天/本月这项次数用完了，明天会恢复；需要更多可以查看升级方案。”不报内部 metric 名。 |
| 提交太快 | `RATE_LIMITED`(429) | 让用户稍等几秒再操作，不要连续点击。 |
| 参数缺失/不合法 | `INVALID_ARGUMENT`(400) | 用一句话指出缺什么（题目/材料/页码），重新追问。 |
| 资源不属于本人/不存在 | `NOT_FOUND`(404) | 统一说“没找到这份内容，可能已过期”，不要区分“存在但无权”，避免泄露。 |
| 返回占位内容而非真实内容 | `DEEPTUTOR_MCP_DETERMINISTIC=1`（开发桩模式） | 这是开发测试模式，只会返回占位结果。真实使用时请关闭该变量，并确保模型已配置；否则说明“当前是测试模式”，不要当成模型故障。 |
| 作业失败 | job `failed` / `JOB_FAILED` | 用自然语言说明生成失败；可调整题目/材料后**用新 idempotency_key** 再试一次。 |
| 作业被取消 | job `canceled` | 告知已取消；需要时重新提交。 |
| 等待补充信息 | job `needs_input` | 调 `capability_job_reply` 补信息，不要重新提交。 |
| 幂等冲突 | `IDEMPOTENCY_CONFLICT`(409) | 同一 request_id 被用于不同操作；让这次重试生成新的 request_id。 |
| 产物链接过期 | `artifact_get` 的 URL 约 15 分钟失效 | 重新调 `artifact_get` 取新链接，不要让用户保存旧链接。 |
| 材料解析失败 | `MATERIAL_PARSE_FAILED` / `EMPTY_MATERIAL` | 请用户换清晰 PDF、直接粘贴文本或提供视频字幕；说明当前支持 PDF/文本/字幕/课件。 |
| 材料内容为空 | `EMPTY_MATERIAL` | 材料里没有可引用的文字，请用户提供有文字内容的版本（扫描件需先 OCR）。 |
| 请求体过大 | `PAYLOAD_TOO_LARGE`(413) | 缩短输入或拆分材料；大文件先作为 artifact 上传再注册精读。 |
| 内部错误 | `INTERNAL_ERROR`(500, retryable) | “服务开了个小差，我再试一次。”最多自动重试 1 次，仍失败建议稍后再试并安抚。 |

## 轮询纪律

- 不要无限转圈：10 分钟未结束先告知用户可稍后回来，用 job_id 后续查询（但不要让用户记录该 ID，技能在会话内保留）。
- 作业失败不要重复扣费式狂试：同一动作复用 idempotency_key；新尝试换新 key。
