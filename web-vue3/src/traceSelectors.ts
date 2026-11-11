/**
 * Turn trace selectors — group raw stream events into renderable call traces.
 * Port of web/features/chat/trace/selectors.ts and model.ts. Pure functions
 * only, so grouping/substance/mode rules are unit-testable without a socket.
 */

export interface TraceEvent {
  type: string
  content?: string
  stage?: string
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export interface TraceMetadata {
  call_id?: string
  call_kind?: string
  trace_role?: string
  trace_group?: string
  trace_kind?: string
  call_state?: string
  call_role?: string
  step_id?: string
  provider?: string
  tool_source?: string
  tool_provider?: string
  tool_metadata?: Record<string, unknown>
  absorbed_into_final?: boolean
  [key: string]: unknown
}

export interface TraceItem {
  callId: string
  events: TraceEvent[]
}

export type TraceDisplayItem =
  | { kind: 'trace'; trace: TraceItem }
  | { kind: 'step'; stepId: string; traces: TraceItem[] }

export type StreamingMode =
  | 'reasoning'
  | 'tool_using'
  | 'responding'
  | 'responded'
  | 'planning'
  | 'exploring'
  | 'quizzing'
  | 'reflecting'

export function getTraceMeta(event: TraceEvent): TraceMetadata {
  return (event.metadata ?? {}) as TraceMetadata
}

export function getTraceCallKind(events: TraceEvent[]): string {
  for (const event of events) {
    const value = getTraceMeta(event).call_kind
    if (value) return String(value)
  }
  return ''
}

export function getTraceGroup(events: TraceEvent[]): string {
  for (const event of events) {
    const value = getTraceMeta(event).trace_group
    if (value) return String(value)
  }
  return ''
}

export function getCallProvider(events: TraceEvent[]): string {
  for (const event of events) {
    const meta = getTraceMeta(event)
    const nested = meta.tool_metadata
    const value =
      (nested && typeof nested.provider === 'string' ? nested.provider : '') ||
      (typeof meta.provider === 'string' ? meta.provider : '') ||
      ''
    const trimmed = value.trim()
    if (trimmed && trimmed !== 'none') return trimmed
  }
  return ''
}

export function getToolProvider(
  events: TraceEvent[],
): { source: string; id: string } | null {
  for (const event of events) {
    const meta = getTraceMeta(event)
    if (meta.tool_source) {
      return { source: String(meta.tool_source), id: String(meta.tool_provider || '') }
    }
  }
  return null
}

export function isTracePending(events: TraceEvent[]): boolean {
  let running = false
  let terminal = false
  for (const event of events) {
    const state = String(getTraceMeta(event).call_state || '')
    if (state === 'running') running = true
    if (state === 'complete' || state === 'error') terminal = true
  }
  return running && !terminal
}

export function groupTraceEvents(events: TraceEvent[]): TraceItem[] {
  const groups = new Map<string, TraceEvent[]>()
  for (const event of events) {
    const callId = String(getTraceMeta(event).call_id || '')
    if (!callId) continue
    const group = groups.get(callId)
    if (group) group.push(event)
    else groups.set(callId, [event])
  }
  return [...groups].map(([callId, groupedEvents]) => ({ callId, events: groupedEvents }))
}

export function isChatLoopAnswerContent(event: TraceEvent): boolean {
  return event.type === 'content' && getTraceMeta(event).call_kind === 'agent_loop_round'
}

export function groupHasTraceSubstance(events: TraceEvent[]): boolean {
  return events.some(event => {
    if (event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'error') {
      return true
    }
    if (event.type === 'thinking' || event.type === 'observation') {
      return Boolean((event.content || '').trim())
    }
    if (event.type === 'progress') {
      return getTraceMeta(event).trace_kind !== 'call_status' && Boolean((event.content || '').trim())
    }
    if (event.type === 'content') {
      return !isChatLoopAnswerContent(event) && Boolean((event.content || '').trim())
    }
    return false
  })
}

export function hasSettledFinalRound(events: TraceEvent[]): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const meta = getTraceMeta(events[index])
    if (meta.trace_kind === 'call_status' && meta.call_state === 'complete') {
      return meta.call_role === 'finish'
    }
  }
  return false
}

export function selectTraceDisplayItems(traceGroups: TraceItem[]): TraceDisplayItem[] {
  const items: TraceDisplayItem[] = []
  let currentStep: string | null = null
  let stepTraces: TraceItem[] = []
  const flush = () => {
    if (currentStep !== null && stepTraces.length) {
      items.push({ kind: 'step', stepId: currentStep, traces: stepTraces })
    }
    currentStep = null
    stepTraces = []
  }

  for (const group of traceGroups) {
    const meta = getTraceMeta(group.events[0])
    const groupType = getTraceGroup(group.events)
    const stepId = meta.step_id ? String(meta.step_id) : ''
    const kind = getTraceCallKind(group.events)
    if (kind === 'llm_final_response') continue
    if (group.events.some(event => getTraceMeta(event).absorbed_into_final === true)) continue
    if (!groupHasTraceSubstance(group.events)) continue

    if (groupType === 'react_round' && stepId) {
      if (currentStep === stepId) stepTraces.push(group)
      else {
        flush()
        currentStep = stepId
        stepTraces = [group]
      }
    } else if (currentStep !== null && kind !== 'llm_generation') {
      stepTraces.push(group)
    } else {
      flush()
      items.push({ kind: 'trace', trace: group })
    }
  }
  flush()
  return items
}

export function hasRenderableCallTrace(events: TraceEvent[]): boolean {
  return selectTraceDisplayItems(groupTraceEvents(events)).length > 0
}

export function detectStreamingMode(
  events: TraceEvent[],
  hasFinalContent: boolean,
  isStreaming: boolean,
): StreamingMode {
  if (!isStreaming) return 'responded'
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    const kind = getTraceMeta(event).call_kind || ''
    if (event.type === 'tool_call') {
      if (event.stage === 'exploring') return 'exploring'
      if (event.stage === 'quizzing') return 'quizzing'
      return 'tool_using'
    }
    if (event.type === 'tool_result') continue
    if (kind === 'agent_loop_round') {
      return event.type === 'content' ? 'responding' : 'exploring'
    }
    if (kind === 'quiz_question_emitted') return 'quizzing'
    if (kind === 'tool_result_reflection') return 'reflecting'
    if (event.type === 'content' && kind === 'llm_final_response') {
      return event.stage === 'exploring' ? 'exploring' : 'responding'
    }
    if (kind === 'llm_planning') return 'planning'
    if (event.type === 'thinking' && kind === 'llm_reasoning') {
      if (event.stage === 'exploring') return 'exploring'
      if (event.stage === 'quizzing') return 'quizzing'
      return 'reasoning'
    }
  }
  return hasFinalContent ? 'responding' : 'reasoning'
}
