import type { SubmittedQuizResult } from './quizSession'

export interface QuizResultItem {
  question_id: string
  question: string
  question_type: string
  options: Record<string, string>
  user_answer: string
  correct_answer: string
  explanation: string
  difficulty: string
  is_correct: boolean
}

/**
 * Recording needs both a conversation and turn identity. A turn-less write
 * can attach positional IDs (`q_1`…) to another quiz in the same session.
 */
export function canRecordQuizResults(
  sessionId: string | null | undefined,
  turnId: string | null | undefined,
  results: SubmittedQuizResult[],
): boolean {
  return Boolean(sessionId?.trim() && turnId?.trim() && results.length > 0)
}

export function quizResultsPayload(
  results: SubmittedQuizResult[],
  turnId: string,
): { answers: QuizResultItem[]; turn_id: string } {
  return {
    answers: results.map(result => ({ ...result })),
    turn_id: turnId,
  }
}

/** Stable in-memory dedupe key for an answer report. */
export function quizResultsSignature(
  sessionId: string,
  turnId: string,
  results: SubmittedQuizResult[],
): string {
  return JSON.stringify([sessionId, turnId, results])
}
