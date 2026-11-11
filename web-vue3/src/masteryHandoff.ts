type StreamLikeEvent = { type?: string; metadata?: unknown }

export type MasteryHandoffKind = 'open' | 'new'

export interface MasteryHandoffPayload {
  kind: MasteryHandoffKind
  path_id: string
  path_name: string
  emoji: string
  session_id: string
  session_title: string
  session_messages: number
  session_updated_at: number
  session_awaiting: boolean
  session_running: boolean
  module_id: string
  module_name: string
  opening_message: string
  reason: string
  due_reviews: number
  mastered: number
  objectives: number
}

function toolPayload(metadata: unknown, key: string): unknown {
  if (!metadata || typeof metadata !== 'object') return undefined
  const record = metadata as Record<string, unknown>
  return (record.tool_metadata && typeof record.tool_metadata === 'object'
    ? (record.tool_metadata as Record<string, unknown>)[key]
    : record[key])
}

function isKind(value: unknown): value is MasteryHandoffKind {
  return value === 'open' || value === 'new'
}

function count(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

export function masteryHandoffFrom(event: { type?: string; metadata?: unknown }): MasteryHandoffPayload | null {
  if (event.type !== 'tool_result') return null
  const raw = toolPayload(event.metadata, 'mastery_handoff')
  if (!raw || typeof raw !== 'object') return null
  const payload = raw as Record<string, unknown>
  if (!isKind(payload.kind)) return null
  const pathId = String(payload.path_id ?? '').trim()
  if (!pathId) return null
  const sessionId = String(payload.session_id ?? '').trim()
  if (payload.kind === 'open' && !sessionId) return null
  return {
    kind: payload.kind,
    path_id: pathId,
    path_name: String(payload.path_name ?? '').trim(),
    emoji: String(payload.emoji ?? '').trim(),
    session_id: sessionId,
    session_title: String(payload.session_title ?? '').trim(),
    session_messages: count(payload.session_messages),
    session_updated_at: count(payload.session_updated_at),
    session_awaiting: Boolean(payload.session_awaiting),
    session_running: Boolean(payload.session_running),
    module_id: String(payload.module_id ?? '').trim(),
    module_name: String(payload.module_name ?? '').trim(),
    opening_message: String(payload.opening_message ?? '').trim(),
    reason: String(payload.reason ?? '').trim(),
    due_reviews: count(payload.due_reviews),
    mastered: count(payload.mastered),
    objectives: count(payload.objectives),
  }
}

export function extractMasteryHandoffs(events: StreamLikeEvent[] | undefined): MasteryHandoffPayload[] {
  if (!events?.length) return []
  const seen = new Set<string>()
  const handoffs: MasteryHandoffPayload[] = []
  for (const event of events) {
    const payload = masteryHandoffFrom(event)
    if (!payload) continue
    const key = `${payload.kind}:${payload.path_id}:${payload.session_id}:${payload.module_id}`
    if (seen.has(key)) continue
    seen.add(key)
    handoffs.push(payload)
  }
  return handoffs
}

export function masteryHandoffHref(payload: MasteryHandoffPayload): string {
  const path = encodeURIComponent(payload.path_id)
  return payload.kind === 'open'
    ? `/learning/mastery/${path}/sessions/${encodeURIComponent(payload.session_id)}`
    : `/learning/mastery/${path}/sessions/outline`
}
