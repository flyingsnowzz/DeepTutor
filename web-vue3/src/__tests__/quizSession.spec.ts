import { describe, expect, it } from 'vitest'
import {
  clampQuestionIndex,
  completedCount,
  navigationProgress,
  patchAnswer,
  resetAnswer,
  showCorrectness,
  submittedResults,
} from '../quiz/quizSession'
import { EMPTY_ANSWER, type AnswerState } from '../quiz/answerState'
import type { QuizQuestion } from '../quiz/quizModel'

const q = (overrides: Partial<QuizQuestion> = {}): QuizQuestion => ({
  question_id: 'q1',
  question: 'Q?',
  question_type: 'choice',
  options: { A: 'Paris', B: 'Lyon' },
  correct_answer: 'A',
  explanation: 'e',
  ...overrides,
})

const ans = (overrides: Partial<AnswerState> = {}): AnswerState => ({ ...EMPTY_ANSWER, ...overrides })

describe('navigationProgress', () => {
  it('computes 1-based percentage and guards empty quizzes', () => {
    expect(navigationProgress(0, 4)).toBe(25)
    expect(navigationProgress(3, 4)).toBe(100)
    expect(navigationProgress(0, 0)).toBe(0)
  })
})

describe('completedCount', () => {
  it('counts submitted answers only', () => {
    expect(completedCount({})).toBe(0)
    expect(completedCount({ 0: ans({ submitted: true }), 1: ans({}), 2: ans({ submitted: true }) })).toBe(2)
  })
})

describe('patchAnswer', () => {
  it('merges a patch without dropping other fields', () => {
    const answers = { 0: ans({ typed: 'keep', images: [{ id: 'i', url: 'u', filename: 'f', mime_type: 'image/png' }] }) }
    const next = patchAnswer(answers, 0, { selected: 'A' })
    expect(next[0]).toMatchObject({ selected: 'A', typed: 'keep' })
    expect(next[0]?.images).toHaveLength(1)
  })
  it('starts from EMPTY_ANSWER for a new index', () => {
    const next = patchAnswer({}, 2, { typed: 'x' })
    expect(next[2]).toEqual({ ...EMPTY_ANSWER, typed: 'x' })
  })
})

describe('resetAnswer', () => {
  it('clears selection/typed/submitted but keeps images', () => {
    const answers = { 0: ans({ selected: 'B', typed: 'x', submitted: true, images: [{ id: 'i', url: 'u', filename: 'f', mime_type: 'image/png' }] }) }
    const next = resetAnswer(answers, 0)
    expect(next[0]).toMatchObject({ selected: null, typed: '', submitted: false })
    expect(next[0]?.images).toHaveLength(1)
  })
})

describe('showCorrectness', () => {
  it('returns null until submitted and correct/incorrect after', () => {
    expect(showCorrectness(q(), ans({ selected: 'A' }))).toBeNull()
    expect(showCorrectness(q(), ans({ selected: 'A', submitted: true }))).toBe(true)
    expect(showCorrectness(q(), ans({ selected: 'B', submitted: true }))).toBe(false)
    expect(showCorrectness(undefined, ans({ submitted: true }))).toBeNull()
  })
})

describe('submittedResults', () => {
  it('flattens only submitted answers into notebook rows', () => {
    const questions = [q(), q({ question_id: 'q2', question_type: 'written', options: undefined, correct_answer: 'essay' })]
    const results = submittedResults(questions, {
      0: ans({ selected: 'A', submitted: true }),
      1: ans({ typed: 'essay', submitted: false }),
    })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ question_id: 'q1', user_answer: 'A', is_correct: true, difficulty: '' })
    expect(results[0]?.options).toEqual({ A: 'Paris', B: 'Lyon' })
  })
})

describe('clampQuestionIndex', () => {
  it('clamps into range and returns null for empty quizzes', () => {
    expect(clampQuestionIndex(-1, 3)).toBe(0)
    expect(clampQuestionIndex(5, 3)).toBe(2)
    expect(clampQuestionIndex(1, 3)).toBe(1)
    expect(clampQuestionIndex(0, 0)).toBeNull()
  })
})
