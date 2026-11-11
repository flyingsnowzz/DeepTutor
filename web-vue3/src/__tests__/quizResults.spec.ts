import { describe, expect, it } from 'vitest'
import {
  canRecordQuizResults,
  quizResultsPayload,
  quizResultsSignature,
} from '../quiz/quizResults'
import type { SubmittedQuizResult } from '../quiz/quizSession'

const result: SubmittedQuizResult = {
  question_id: 'q1',
  question: '2 + 2?',
  question_type: 'choice',
  options: { A: '3', B: '4' },
  user_answer: 'B',
  correct_answer: 'B',
  explanation: 'Two plus two is four.',
  difficulty: 'easy',
  is_correct: true,
}

describe('quiz result persistence', () => {
  it('requires a session, turn and at least one answer', () => {
    expect(canRecordQuizResults('s1', 't1', [result])).toBe(true)
    expect(canRecordQuizResults('', 't1', [result])).toBe(false)
    expect(canRecordQuizResults('s1', '', [result])).toBe(false)
    expect(canRecordQuizResults('s1', 't1', [])).toBe(false)
  })

  it('builds the backend quiz-results payload without sharing answer objects', () => {
    const payload = quizResultsPayload([result], 't1')
    expect(payload).toEqual({ answers: [result], turn_id: 't1' })
    expect(payload.answers[0]).not.toBe(result)
  })

  it('changes its dedupe key when the turn or an answer changes', () => {
    const first = quizResultsSignature('s1', 't1', [result])
    expect(quizResultsSignature('s1', 't1', [result])).toBe(first)
    expect(quizResultsSignature('s1', 't2', [result])).not.toBe(first)
    expect(
      quizResultsSignature('s1', 't1', [{ ...result, user_answer: 'A', is_correct: false }]),
    ).not.toBe(first)
  })
})
