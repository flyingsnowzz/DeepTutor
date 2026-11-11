/**
 * Turn activity labels — turn raw WebSocket event types into human-readable
 * Chinese activity entries for the in-chat activity stream. The old client
 * renders rich per-event components; this is the shared label/state layer the
 * Vue3 activity presenter builds on, keeping unknown types readable too.
 */

export type ActivityTone = 'neutral' | 'active' | 'success' | 'warning' | 'danger'

export interface ActivityLabel {
  label: string
  tone: ActivityTone
}

const LABELS: Record<string, ActivityLabel> = {
  // Lifecycle / transport
  active_turn_info: { label: '回合状态', tone: 'neutral' },
  command_ack: { label: '指令确认', tone: 'neutral' },
  protocol_error: { label: '协议错误', tone: 'danger' },
  wait_for_input: { label: '等待你的补充信息', tone: 'warning' },
  // Reasoning / progress
  reasoning: { label: '正在思考', tone: 'active' },
  thinking: { label: '正在思考', tone: 'active' },
  status: { label: '进度更新', tone: 'active' },
  stage: { label: '阶段进展', tone: 'active' },
  progress: { label: '处理中', tone: 'active' },
  // Tool / capability calls
  tool_call: { label: '调用工具', tone: 'active' },
  tool_start: { label: '工具开始', tone: 'active' },
  tool_result: { label: '工具结果', tone: 'neutral' },
  tool_error: { label: '工具出错', tone: 'danger' },
  capability: { label: '能力执行', tone: 'active' },
  // Knowledge / retrieval
  retrieval: { label: '检索资料', tone: 'active' },
  search: { label: '联网搜索', tone: 'active' },
  memory: { label: '读取记忆', tone: 'active' },
  // Artifacts
  artifact: { label: '生成产物', tone: 'success' },
  chart: { label: '生成图表', tone: 'success' },
  image: { label: '生成图片', tone: 'success' },
  video: { label: '生成视频', tone: 'success' },
  citation: { label: '引用来源', tone: 'neutral' },
  // Terminal / errors
  error: { label: '发生错误', tone: 'danger' },
  done: { label: '回合完成', tone: 'success' },
}

const TONE_BY_PREFIX: Array<[string, ActivityTone]> = [
  ['error', 'danger'],
  ['fail', 'danger'],
  ['done', 'success'],
  ['complete', 'success'],
  ['result', 'neutral'],
  ['start', 'active'],
  ['progress', 'active'],
]

/** Human label + tone for an event type, with a readable fallback for unknown types. */
export function labelTurnEvent(type: string | undefined): ActivityLabel {
  const safeType = type || 'event'
  const known = LABELS[safeType]
  if (known) return known
  const lower = safeType.toLowerCase()
  for (const [prefix, tone] of TONE_BY_PREFIX) {
    if (lower.includes(prefix)) return { label: humanizeEventType(type), tone }
  }
  return { label: humanizeEventType(type), tone: 'neutral' }
}

/** Turn snake_case event types into spaced display text without inventing semantics. */
export function humanizeEventType(type: string | undefined): string {
  return (type || 'event')
    .split('_')
    .filter(Boolean)
    .map(part => part)
    .join(' ')
}

/** Short one-line detail for an activity row, preferring content then message. */
export function activityDetail(event: { content?: string; message?: string }): string {
  const raw = (event.content || event.message || '').trim()
  return raw.length > 140 ? `${raw.slice(0, 140)}…` : raw
}
