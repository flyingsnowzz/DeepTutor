export type SubagentEvent = {
  type?: string
  content?: string
  source?: string
  timestamp?: number
  metadata?: Record<string, unknown>
}

export interface SubagentEventGroup {
  key: string
  label: string
  events: SubagentEvent[]
}

export function subagentMeta(event: SubagentEvent): Record<string, unknown> {
  return event.metadata && typeof event.metadata === 'object' ? event.metadata : {}
}

export function isSubagentEvent(event: SubagentEvent): boolean {
  return subagentMeta(event).trace_kind === 'subagent_event'
}

export function groupSubagentEvents(
  messages: ReadonlyArray<{ events?: SubagentEvent[] }> | undefined,
): SubagentEventGroup[] {
  const groups = new Map<string, SubagentEventGroup>()
  for (const message of messages || []) {
    for (const event of message.events || []) {
      if (!isSubagentEvent(event)) continue
      const meta = subagentMeta(event)
      const key = String(meta.turn_id || meta.call_id || meta.trace_id || '')
      if (!key) continue
      const label = String(meta.subagent_name || groups.get(key)?.label || 'Subagent')
      const existing = groups.get(key)
      if (existing) {
        existing.events.push(event)
        existing.label = label
      } else {
        groups.set(key, { key, label, events: [event] })
      }
    }
  }
  return [...groups.values()]
}

export function visibleSubagentEvents(events: SubagentEvent[]): SubagentEvent[] {
  const latest = new Map<string, SubagentEvent>()
  for (const event of events) {
    const mergeId = String(subagentMeta(event).subagent_merge_id || '')
    if (mergeId) latest.set(mergeId, event)
  }
  const seen = new Set<string>()
  const visible: SubagentEvent[] = []
  for (const event of events) {
    const mergeId = String(subagentMeta(event).subagent_merge_id || '')
    if (mergeId) {
      if (seen.has(mergeId)) continue
      seen.add(mergeId)
      visible.push(latest.get(mergeId) || event)
    } else {
      visible.push(event)
    }
  }
  return visible
}

export function subagentIdentity(events: SubagentEvent[]): {
  name: string
  kind: string
  partnerId: string
  partnerSessionKey: string
  groupId: string
  groupSessionKey: string
} {
  const values = {
    name: '',
    kind: '',
    partnerId: '',
    partnerSessionKey: '',
    groupId: '',
    groupSessionKey: '',
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const meta = subagentMeta(events[index]!)
    values.name ||= String(meta.subagent_name || '')
    values.kind ||= String(meta.subagent_kind || '')
    values.partnerId ||= String(meta.partner_id || '')
    values.partnerSessionKey ||= String(meta.partner_session_key || '')
    values.groupId ||= String(meta.partner_group_id || '')
    values.groupSessionKey ||= String(meta.partner_group_session_key || '')
  }
  return values
}
