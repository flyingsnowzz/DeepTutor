import { describe, expect, it } from 'vitest'
import {
  answerSummary,
  EMPTY_ANSWER,
  getQuestionKey,
  getUserAnswer,
  hasAnswer,
  isAnswerCorrect,
  isAutoGradable,
  isMultipleChoice,
  makeAnswerImageId,
  type AnswerState,
} from '../quiz/answerState'
import type { QuizQuestion } from '../quiz/quizModel'

function question(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    question_id: 'q1',
    question: 'Q?',
    question_type: 'choice',
    options: { A: 'Paris', B: 'Lyon' },
    correct_answer: 'A',
    explanation: '',
    ...overrides,
  }
}

function answer(overrides: Partial<AnswerState> = {}): AnswerState {
  return { ...EMPTY_ANSWER, ...overrides }
}

describe('getQuestionKey', () => {
  it('uses question_id, else positional fallback', () => {
    expect(getQuestionKey(question(), 0)).toBe('q1')
    expect(getQuestionKey(question({ question_id: '' }), 2)).toBe('question_3')
  })
})

describe('isMultipleChoice / isAutoGradable', () => {
  it('requires options for multi-choice', () => {
    expect(isMultipleChoice(question())).toBe(true)
    expect(isMultipleChoice(question({ options: {} }))).toBe(false)
    expect(isMultipleChoice(question({ question_type: 'written' }))).toBe(false)
  })
  it('auto-grades choice, concept and fill-in-blank only', () => {
    expect(isAutoGradable(question())).toBe(true)
    expect(isAutoGradable(question({ question_type: 'concept', options: undefined }))).toBe(true)
    expect(isAutoGradable(question({ question_type: 'fill_in_blank', options: undefined }))).toBe(true)
    expect(isAutoGradable(question({ question_type: 'short_answer', options: undefined }))).toBe(false)
    expect(isAutoGradable(question({ question_type: 'coding', options: undefined }))).toBe(false)
  })
})

describe('getUserAnswer / hasAnswer', () => {
  it('uses selected for choice/concept and trimmed typed otherwise', () => {
    expect(getUserAnswer(question(), answer({ selected: 'B', typed: 'ignored' }))).toBe('B')
    expect(getUserAnswer(question({ question_type: 'concept', options: undefined }), answer({ selected: 'true' }))).toBe('true')
    expect(getUserAnswer(question({ question_type: 'written', options: undefined }), answer({ typed: '  essay  ' }))).toBe('essay')
  })
  it('counts images as an answer', () => {
    const q = question({ question_type: 'written', options: undefined })
    expect(hasAnswer(q, answer())).toBe(false)
    expect(hasAnswer(q, answer({ typed: 'x' }))).toBe(true)
    expect(hasAnswer(q, answer({ images: [{ id: 'i', url: 'u', filename: 'f', mime_type: 'image/png' }] }))).toBe(true)
  })
})

describe('isAnswerCorrect', () => {
  it('accepts direct key, full correct answer and first letter for choice', () => {
    expect(isAnswerCorrect(question(), answer({ selected: 'A' }))).toBe(true)
    expect(isAnswerCorrect(question({ correct_answer: 'paris' }), answer({ selected: 'PARIS' }))).toBe(true)
    expect(isAnswerCorrect(question({ correct_answer: 'Paris' }), answer({ selected: 'P' }))).toBe(true)
    expect(isAnswerCorrect(question(), answer({ selected: 'B' }))).toBe(false)
    expect(isAnswerCorrect(question(), answer())).toBe(false)
  })
  it('canonicalizes true/false for concept questions', () => {
    const q = question({ question_type: 'concept', options: undefined, correct_answer: 'TRUE' })
    expect(isAnswerCorrect(q, answer({ selected: 'true' }))).toBe(true)
    expect(isAnswerCorrect(q, answer({ selected: 'false' }))).toBe(false)
    const invalid = question({ question_type: 'concept', options: undefined, correct_answer: 'maybe' })
    expect(isAnswerCorrect(invalid, answer({ selected: '' }))).toBe(false)
  })
  it('compares fill-in-blank case-insensitively', () => {
    const q = question({ question_type: 'fill_in_blank', options: undefined, correct_answer: 'Fourier' })
    expect(isAnswerCorrect(q, answer({ typed: ' fourier ' }))).toBe(true)
    expect(isAnswerCorrect(q, answer({ typed: 'laplace' }))).toBe(false)
  })
})

describe('answerSummary', () => {
  it('counts submitted answers and grades only auto-gradable ones', () => {
    const questions = [question(), question({ question_id: 'q2', question_type: 'written', options: undefined })]
    const answers = {
      0: answer({ selected: 'A', submitted: true }),
      1: answer({ typed: 'essay', submitted: true }),
    }
    expect(answerSummary(questions, answers)).toEqual({ answered: 2, graded: 1, correct: 1 })
    expect(answerSummary(questions, { 0: answer({ submitted: false }) })).toEqual({ answered: 0, graded: 0, correct: 0 })
    expect(answerSummary(questions, {})).toEqual({ answered: 0, graded: 0, correct: 0 })
  })
})

describe('makeAnswerImageId', () => {
  it('strips dashes and truncates to 12 chars', () => {
    expect(makeAnswerImageId('12345678-90ab-cdef')).toBe('1234567890ab')
  })
})
