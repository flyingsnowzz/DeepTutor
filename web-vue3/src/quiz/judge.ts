/**
 * AI quiz judge over WebSocket — Vue3 port of web/lib/quiz-judge.ts.
 * The socket factory is injectable so the state machine is unit-testable
 * without a live backend. URL construction mirrors ChatPage/WhisperPage:
 * `${protocol}//${location.host}${scopedUrl('/ws/questions/judge')}`.
 */
import { scopedUrl } from '../workspaceScope'

export interface QuizJudgeImage {
  /** Base64 of the freshly-picked image (no ``data:`` prefix). */
  base64: string | null
  /** AttachmentStore URL for a previously persisted image. */
  url: string | null
  filename: string
  mime_type: string
}

export interface QuizJudgeRequest {
  question: string
  question_type: string
  options: Record<string, string> | null
  correct_answer: string
  explanation: string
  user_answer: string
  user_answer_images: QuizJudgeImage[]
  language: string
}

export interface QuizJudgeHandle {
  close: () => void
  cancel: () => void
}

export interface QuizJudgeHandlers {
  onStart?: () => void
  onChunk: (chunk: string) => void
  onDone: (finalText: string) => void
  onError: (message: string) => void
}

/** Minimal socket surface the state machine needs; real WebSocket satisfies it. */
export interface JudgeSocket {
  send: (data: string) => void
  close: () => void
  onopen: (() => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: (() => void) | null
  onclose: (() => void) | null
}

export type JudgeSocketFactory = (url: string) => JudgeSocket

export const QUIZ_JUDGE_IDLE_TIMEOUT_MS = 2 * 60_000
export const QUIZ_JUDGE_ERROR_MESSAGES = {
  timeout: 'AI judge timed out. Please try again.',
  failed: 'AI judge failed.',
  connection: 'AI judge connection error.',
  closed: 'AI judge connection closed unexpectedly.',
  cancelled: 'AI judgment stopped.',
} as const

/** Resolve the judge WebSocket URL for the current origin/workspace. */
export function quizJudgeUrl(locationLike: { protocol: string; host: string }): string {
  const protocol = locationLike.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${locationLike.host}${scopedUrl('/ws/questions/judge')}`
}

const defaultFactory: JudgeSocketFactory = (url) => new WebSocket(url) as unknown as JudgeSocket

export function startQuizJudge(
  payload: QuizJudgeRequest,
  handlers: QuizJudgeHandlers,
  factory: JudgeSocketFactory = defaultFactory,
): QuizJudgeHandle {
  const ws = factory(
    typeof location === 'undefined'
      ? '/ws/questions/judge'
      : quizJudgeUrl(location),
  )
  let buffer = ''
  let finished = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined

  const clearIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = undefined
  }

  const finalize = (kind: 'done' | 'error', message?: string) => {
    if (finished) return
    finished = true
    clearIdleTimer()
    if (kind === 'done') handlers.onDone(buffer)
    else handlers.onError(message ?? QUIZ_JUDGE_ERROR_MESSAGES.failed)
    try {
      ws.close()
    } catch {
      /* ignore */
    }
  }

  const armIdleTimer = () => {
    clearIdleTimer()
    idleTimer = setTimeout(() => {
      finalize('error', QUIZ_JUDGE_ERROR_MESSAGES.timeout)
    }, QUIZ_JUDGE_IDLE_TIMEOUT_MS)
  }

  ws.onopen = () => {
    armIdleTimer()
    try {
      ws.send(JSON.stringify(payload))
    } catch (err) {
      finalize('error', err instanceof Error ? err.message : String(err))
    }
  }

  ws.onmessage = (ev) => {
    armIdleTimer()
    let frame: { type?: string; content?: string }
    try {
      frame = JSON.parse(String(ev.data)) as { type?: string; content?: string }
    } catch {
      return
    }
    if (frame.type === 'started') {
      handlers.onStart?.()
      return
    }
    if (frame.type === 'text' && typeof frame.content === 'string') {
      buffer += frame.content
      handlers.onChunk(frame.content)
      return
    }
    if (frame.type === 'done') {
      finalize('done')
      return
    }
    if (frame.type === 'error') {
      finalize('error', frame.content || QUIZ_JUDGE_ERROR_MESSAGES.failed)
    }
  }

  ws.onerror = () => finalize('error', QUIZ_JUDGE_ERROR_MESSAGES.connection)
  ws.onclose = () => {
    if (!finished) finalize('error', QUIZ_JUDGE_ERROR_MESSAGES.closed)
  }

  return {
    close: () => {
      if (!finished) finished = true
      clearIdleTimer()
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    },
    cancel: () => finalize('error', QUIZ_JUDGE_ERROR_MESSAGES.cancelled),
  }
}

/** Read a freshly-picked image as base64 with its MIME type and filename. */
export function readFileAsBase64(
  file: File,
): Promise<{ base64: string; mime: string; name: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Failed to read file'))
        return
      }
      const comma = result.indexOf(',')
      const base64 = comma >= 0 ? result.slice(comma + 1) : result
      resolve({
        base64,
        mime: file.type || 'image/png',
        name: file.name || 'answer.png',
      })
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
