export type SideChatResponder =
  | { kind: 'dito' }
  | { kind: 'partner'; id: string; name: string }
  | { kind: 'subagent'; id: string; name: string }
  | { kind: 'partner_group'; id: string; name: string }

export const DITO: SideChatResponder = { kind: 'dito' }

export interface SideChatContext {
  parentSessionId: string | null
  leafMessageId: number | null
  parentTitle?: string
  responder: SideChatResponder
}

export interface SideChatAttachment {
  type: string
  filename?: string
  base64?: string
  mime_type?: string
  url?: string
  size_bytes?: number
  previewUrl?: string
}

export interface SideChatEvent {
  type?: string
  content?: string
  message?: string
  session_id?: string
  turn_id?: string
  seq?: number
  metadata?: Record<string, unknown>
}

export interface SideChatMessage {
  role: 'user' | 'assistant'
  content: string
  events?: SideChatEvent[]
  quotes?: string[]
}

export interface SideChatState {
  sessionId: string
  activeTurnId: string
  messages: SideChatMessage[]
  streaming: string
  streamEvents: SideChatEvent[]
  busy: boolean
  error: string
}

export function emptySideChatState(sessionId = ''): SideChatState {
  return {
    sessionId,
    activeTurnId: '',
    messages: [],
    streaming: '',
    streamEvents: [],
    busy: false,
    error: '',
  }
}

export function sameResponder(a: SideChatResponder, b: SideChatResponder): boolean {
  return a.kind === b.kind && (a.kind === 'dito' || a.id === (b as { id: string }).id)
}

function answerBy(responder: SideChatResponder): string {
  if (responder.kind === 'partner') return `partner:${responder.id}`
  if (responder.kind === 'subagent') return `subagent:${responder.id}`
  return ''
}

export function sideChatTurnConfig(context: SideChatContext): Record<string, unknown> {
  return {
    ...(context.parentSessionId
      ? {
          selection_tutor_context: {
            parent_session_id: context.parentSessionId,
            source_message_id: context.leafMessageId,
          },
        }
      : {}),
    answer_by: answerBy(context.responder),
    ...(context.responder.kind === 'partner_group'
      ? { partner_discussion_group_id: context.responder.id }
      : {}),
  }
}

export function responderFromPreferences(
  preferences: Record<string, unknown> | null | undefined,
): SideChatResponder {
  const groupId = typeof preferences?.side_chat_group_id === 'string'
    ? preferences.side_chat_group_id.trim()
    : ''
  if (groupId) return { kind: 'partner_group', id: groupId, name: groupId }
  const [kind, ...rest] = String(preferences?.answer_by || '').split(':')
  const id = rest.join(':').trim()
  if (id && kind === 'partner') return { kind: 'partner', id, name: id }
  if (id && kind === 'subagent') return { kind: 'subagent', id, name: id }
  return DITO
}

export function sideChatKey(parentSessionId: string | null): string {
  return `side-chat:${parentSessionId || 'new'}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function buildSideChatStartCommand(options: {
  content: string
  context: SideChatContext
  sessionId?: string | null
  language?: string | null
  attachments?: SideChatAttachment[]
  knowledgeBases?: string[]
  skills?: string[]
  mcp?: string[]
  persona?: string | null
  llmSelection?: { profile_id: string; model_id: string } | null
  notebookReferences?: Array<{ notebook_id: string; record_ids: string[] }>
  historyReferences?: string[]
  bookReferences?: Array<{ book_id: string; page_ids: string[] }>
  readingReferences?: Array<{ material_id: string; revision: number; locators: number[] }>
  questionNotebookReferences?: number[]
  memoryReferences?: string[]
  config?: Record<string, unknown>
}): Record<string, unknown> {
  const llm = options.llmSelection
  return {
    type: 'start_turn',
    content: options.content,
    client_submission_id:
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    capability: 'chat',
    config: { ...sideChatTurnConfig(options.context), ...(options.config || {}) },
    language: options.language || null,
    attachments: options.attachments || [],
    knowledge_bases: options.knowledgeBases || [],
    skills: options.skills || [],
    mcp: options.mcp || [],
    persona: options.persona || null,
    tools: [],
    ...(llm ? { llm_selection: llm } : {}),
    ...(options.notebookReferences?.length ? { notebook_references: options.notebookReferences } : {}),
    ...(options.historyReferences?.length ? { history_references: options.historyReferences } : {}),
    ...(options.bookReferences?.length ? { book_references: options.bookReferences } : {}),
    ...(options.readingReferences?.length ? { reading_references: options.readingReferences } : {}),
    ...(options.questionNotebookReferences?.length ? { question_notebook_references: options.questionNotebookReferences } : {}),
    ...(options.memoryReferences?.length ? { memory_references: options.memoryReferences } : {}),
    ...(options.sessionId ? { session_id: options.sessionId } : {}),
  }
}

export function applySideChatEvent(state: SideChatState, event: SideChatEvent): SideChatState {
  const next: SideChatState = { ...state, streamEvents: [...state.streamEvents] }
  if (event.session_id) next.sessionId = event.session_id
  if (event.turn_id) next.activeTurnId = event.turn_id
  if (event.type === 'session' || event.type === 'session_meta') {
    if (event.metadata?.session_id) next.sessionId = String(event.metadata.session_id)
    if (event.metadata?.turn_id) next.activeTurnId = String(event.metadata.turn_id)
    return next
  }
  if (event.type === 'content') {
    next.streaming += event.content || ''
    return next
  }
  if (event.type === 'error' || event.type === 'protocol_error') {
    next.error = event.message || event.content || 'Side chat failed'
    next.busy = false
    next.activeTurnId = ''
    return next
  }
  if (event.type === 'done') {
    if (next.streaming || next.streamEvents.length) {
      next.messages = [
        ...next.messages,
        { role: 'assistant', content: next.streaming, events: [...next.streamEvents] },
      ]
    }
    next.streaming = ''
    next.streamEvents = []
    next.busy = false
    next.activeTurnId = ''
    return next
  }
  if (event.type && !['active_turn_info', 'command_ack'].includes(event.type)) {
    next.streamEvents.push(event)
  }
  return next
}
