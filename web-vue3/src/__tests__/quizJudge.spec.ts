import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  QUIZ_JUDGE_ERROR_MESSAGES,
  QUIZ_JUDGE_IDLE_TIMEOUT_MS,
  quizJudgeUrl,
  readFileAsBase64,
  startQuizJudge,
  type JudgeSocket,
  type QuizJudgeRequest,
} from '../quiz/judge'

type FakeJudgeSocket = JudgeSocket & { calls: string[]; closed: boolean }

function makeFakeSocket(): FakeJudgeSocket {
  return {
    calls: [],
    closed: false,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send(data: string) {
      this.calls.push(data)
    },
    close() {
      this.closed = true
    },
  }
}

const payload: QuizJudgeRequest = {
  question: 'Q?',
  question_type: 'short_answer',
  options: null,
  correct_answer: 'A',
  explanation: 'because',
  user_answer: 'my answer',
  user_answer_images: [],
  language: 'zh',
}

function makeHandlers() {
  return {
    onStart: vi.fn(),
    onChunk: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
  }
}

describe('quizJudgeUrl', () => {
  it('picks ws/wss from the page protocol and scopes the judge path', () => {
    expect(quizJudgeUrl({ protocol: 'http:', host: 'localhost:5173' })).toContain('ws://localhost:5173/')
    expect(quizJudgeUrl({ protocol: 'https:', host: 'app.test' })).toContain('wss://app.test/')
    expect(quizJudgeUrl({ protocol: 'https:', host: 'app.test' })).toContain('/ws/questions/judge')
  })
})

describe('startQuizJudge', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends the payload on open and streams text chunks until done', () => {
    const socket = makeFakeSocket()
    const handlers = makeHandlers()
    startQuizJudge(payload, handlers, () => socket)
    socket.onopen?.()
    expect(JSON.parse(socket.calls[0] ?? '{}')).toMatchObject({ question: 'Q?', user_answer: 'my answer' })

    socket.onmessage?.({ data: JSON.stringify({ type: 'started' }) })
    expect(handlers.onStart).toHaveBeenCalledTimes(1)

    socket.onmessage?.({ data: JSON.stringify({ type: 'text', content: 'Good' }) })
    socket.onmessage?.({ data: JSON.stringify({ type: 'text', content: ' answer' }) })
    expect(handlers.onChunk).toHaveBeenNthCalledWith(1, 'Good')
    expect(handlers.onChunk).toHaveBeenNthCalledWith(2, ' answer')

    socket.onmessage?.({ data: JSON.stringify({ type: 'done' }) })
    expect(handlers.onDone).toHaveBeenCalledWith('Good answer')
    expect(socket.closed).toBe(true)
  })

  it('ignores malformed frames and resets the idle timer on each message', () => {
    const socket = makeFakeSocket()
    const handlers = makeHandlers()
    startQuizJudge(payload, handlers, () => socket)
    socket.onopen?.()
    socket.onmessage?.({ data: 'not-json' })
    expect(handlers.onChunk).not.toHaveBeenCalled()
    socket.onmessage?.({ data: JSON.stringify({ type: 'text', content: 'x' }) })
    vi.advanceTimersByTime(QUIZ_JUDGE_IDLE_TIMEOUT_MS - 100)
    expect(handlers.onError).not.toHaveBeenCalled()
  })

  it('errors on idle timeout, connection error, error frame and unexpected close', () => {
    // Idle timeout
    const timeoutSocket = makeFakeSocket()
    const timeoutHandlers = makeHandlers()
    startQuizJudge(payload, timeoutHandlers, () => timeoutSocket)
    timeoutSocket.onopen?.()
    vi.advanceTimersByTime(QUIZ_JUDGE_IDLE_TIMEOUT_MS + 1)
    expect(timeoutHandlers.onError).toHaveBeenCalledWith(QUIZ_JUDGE_ERROR_MESSAGES.timeout)

    // Explicit error frame carries its own content
    const errorSocket = makeFakeSocket()
    const errorHandlers = makeHandlers()
    startQuizJudge(payload, errorHandlers, () => errorSocket)
    errorSocket.onopen?.()
    errorSocket.onmessage?.({ data: JSON.stringify({ type: 'error', content: 'judge unavailable' }) })
    expect(errorHandlers.onError).toHaveBeenCalledWith('judge unavailable')

    // onerror
    const connSocket = makeFakeSocket()
    const connHandlers = makeHandlers()
    startQuizJudge(payload, connHandlers, () => connSocket)
    connSocket.onopen?.()
    connSocket.onerror?.()
    expect(connHandlers.onError).toHaveBeenCalledWith(QUIZ_JUDGE_ERROR_MESSAGES.connection)

    // unexpected onclose before finish
    const closeSocket = makeFakeSocket()
    const closeHandlers = makeHandlers()
    startQuizJudge(payload, closeHandlers, () => closeSocket)
    closeSocket.onopen?.()
    closeSocket.onclose?.()
    expect(closeHandlers.onError).toHaveBeenCalledWith(QUIZ_JUDGE_ERROR_MESSAGES.closed)
  })

  it('finalizes only once and supports explicit cancel/close', () => {
    const socket = makeFakeSocket()
    const handlers = makeHandlers()
    const handle = startQuizJudge(payload, handlers, () => socket)
    socket.onopen?.()
    handle.cancel()
    expect(handlers.onError).toHaveBeenCalledWith(QUIZ_JUDGE_ERROR_MESSAGES.cancelled)
    // A later close must not emit a second error.
    socket.onclose?.()
    expect(handlers.onError).toHaveBeenCalledTimes(1)

    const socket2 = makeFakeSocket()
    const handlers2 = makeHandlers()
    const handle2 = startQuizJudge(payload, handlers2, () => socket2)
    socket2.onopen?.()
    handle2.close()
    expect(socket2.closed).toBe(true)
    socket2.onclose?.()
    expect(handlers2.onError).not.toHaveBeenCalled()
  })
})

describe('readFileAsBase64', () => {
  it('strips the data URL prefix and defaults MIME/name', async () => {
    const file = new File(['hello'], 'answer.png', { type: 'image/png' })
    const result = await readFileAsBase64(file)
    expect(result.base64).not.toContain(',')
    expect(result.mime).toBe('image/png')
    expect(result.name).toBe('answer.png')
    expect(atob(result.base64)).toBe('hello')
  })
})
