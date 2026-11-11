import type { AnswerState } from './answerState'
import { getUserAnswer, isAnswerCorrect } from './answerState'
import type { QuizQuestion } from './quizModel'
import { buildQuizFollowupConfig } from './quizModel'

export interface QuizFollowupEvent {
  type?: string
  content?: string
  message?: string
  session_id?: string
  turn_id?: string
  seq?: number
  metadata?: Record<string, unknown>
}

export interface QuizFollowupMessage {
  role: 'user' | 'assistant'
  content: string
  events?: QuizFollowupEvent[]
}

export interface QuizFollowupState {
  sessionId: string
  activeTurnId: string
  messages: QuizFollowupMessage[]
  streaming: string
  streamEvents: QuizFollowupEvent[]
  busy: boolean
  error: string
}

export function emptyQuizFollowupState(): QuizFollowupState {
  return {
    sessionId: '',
    activeTurnId: '',
    messages: [],
    streaming: '',
    streamEvents: [],
    busy: false,
    error: '',
  }
}

export interface QuizFollowupStartOptions {
  question: QuizQuestion
  answer: AnswerState
  userAnswer: string
  isCorrect: boolean | null
  parentSessionId?: string | null
  sessionId?: string | null
  turnId?: string | null
  content: string
  language?: string | null
}

export function buildQuizFollowupStartCommand(options: QuizFollowupStartOptions): Record<string, unknown> {
  const attachments = options.answer.images.map(image => ({
    type: 'image' as const,
    filename: image.filename,
    mime_type: image.mime_type,
    ...(image.base64 ? { base64: image.base64 } : {}),
    ...(image.url ? { url: image.url } : {}),
  }))
  return {
    type: 'start_turn',
    content: options.content,
    client_submission_id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    capability: 'chat',
    config: buildQuizFollowupConfig(
      options.question,
      options.userAnswer,
      options.isCorrect,
      options.parentSessionId,
      {
        userAnswerImageFilenames: options.answer.images.map(image => image.filename),
      },
    ),
    language: options.language || null,
    attachments,
    knowledge_bases: [],
    skills: [],
    mcp: [],
    persona: null,
    tools: [],
    ...(options.sessionId ? { session_id: options.sessionId } : {}),
  }
}

/** Fold one unified-WS event into the isolated follow-up thread. */
export function applyQuizFollowupEvent(
  state: QuizFollowupState,
  event: QuizFollowupEvent,
): QuizFollowupState {
  const next: QuizFollowupState = { ...state, streamEvents: [...state.streamEvents] }
  if (event.session_id) next.sessionId = event.session_id
  if (event.turn_id) next.activeTurnId = event.turn_id
  if (event.type === 'session' || event.type === 'session_meta') {
    const metadata = event.metadata ?? {}
    if (metadata.session_id) next.sessionId = String(metadata.session_id)
    if (metadata.turn_id) next.activeTurnId = String(metadata.turn_id)
    return next
  }
  if (event.type === 'content') {
    next.streaming += event.content || ''
    return next
  }
  if (event.type === 'error' || event.type === 'protocol_error') {
    next.error = event.message || event.content || '追问失败'
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

export function quizFollowupContext(question: QuizQuestion, answer: AnswerState) {
  const userAnswer = getUserAnswer(question, answer)
  return {
    userAnswer,
    isCorrect: userAnswer ? isAnswerCorrect(question, answer) : null,
  }
}
