/**
 * Extract quiz questions from a persisted/streamed chat message.
 * Combines the two React paths: live per-question content events and the
 * legacy result envelope inside message metadata.
 */
import {
  extractQuizQuestions,
  extractStreamingQuizQuestions,
  type QuizQuestion,
} from './quizModel'

interface QuizMessageEvent {
  type?: string
  metadata?: Record<string, unknown>
}

interface QuizMessageLike {
  metadata?: Record<string, unknown>
  events?: QuizMessageEvent[]
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Resolve quiz questions for one message, preferring live streaming events
 * (so partial quizzes render while generating) and falling back to the
 * settled `result` metadata envelope.
 */
export function quizQuestionsForMessage(message: QuizMessageLike): QuizQuestion[] | null {
  const streamed = extractStreamingQuizQuestions(message.events)
  if (streamed) return streamed

  const metadata = asRecord(message.metadata)
  if (metadata) {
    const direct = extractQuizQuestions(metadata)
    if (direct) return direct
    const result = asRecord(metadata.result)
    if (result) {
      const fromResult = extractQuizQuestions(result)
      if (fromResult) return fromResult
    }
    const summary = asRecord(metadata.summary)
    if (summary) {
      const fromSummary = extractQuizQuestions({ summary })
      if (fromSummary) return fromSummary
    }
  }

  // Some persisted turns put the result envelope on the last event.
  for (const event of [...(message.events ?? [])].reverse()) {
    if (event.type !== 'result') continue
    const found = extractQuizQuestions(event.metadata)
    if (found) return found
  }
  return null
}

/** Questions emitted so far in the streamed turn (used while generating). */
export function streamingQuizQuestions(
  events: QuizMessageEvent[] | undefined,
): QuizQuestion[] | null {
  return extractStreamingQuizQuestions(events)
}
