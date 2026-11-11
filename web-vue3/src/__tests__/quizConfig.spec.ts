import { describe, expect, it } from 'vitest'
import {
  clampQuestionCount,
  isQuizConfigSubmittable,
  QUIZ_DIFFICULTIES,
  rebalanceCounts,
  reconcileQuizConfig,
  toggleQuestionType,
  totalTypeCount,
  typePercentages,
} from '../quiz/quizConfig'
import { DEFAULT_QUIZ_CONFIG, type DeepQuestionFormConfig } from '../quiz/quizModel'

const cfg = (overrides: Partial<DeepQuestionFormConfig> = {}): DeepQuestionFormConfig => ({
  ...DEFAULT_QUIZ_CONFIG,
  ...overrides,
})

describe('rebalanceCounts', () => {
  it('returns empty for fewer than two types', () => {
    expect(rebalanceCounts(['choice'], 5, {})).toEqual({})
  })
  it('preserves valid counts that already sum to the total', () => {
    const prev = { choice: 2, concept: 3 }
    expect(rebalanceCounts(['choice', 'concept'], 5, prev)).toEqual(prev)
  })
  it('rebuilds an equal split with remainder on first types', () => {
    expect(rebalanceCounts(['choice', 'concept', 'coding'], 7, {})).toEqual({
      choice: 3,
      concept: 2,
      coding: 2,
    })
  })
  it('ensures every type gets at least one', () => {
    expect(rebalanceCounts(['choice', 'concept'], 1, {})).toEqual({ choice: 1, concept: 1 })
  })
  it('drops invalid (non-positive) preserved counts and rebuilds', () => {
    expect(rebalanceCounts(['choice', 'concept'], 4, { choice: 0, concept: 4 })).toEqual({
      choice: 2,
      concept: 2,
    })
  })
})

describe('reconcileQuizConfig', () => {
  it('is a no-op for mimic mode', () => {
    const mimic = cfg({ mode: 'mimic' })
    expect(reconcileQuizConfig(mimic)).toBe(mimic)
  })
  it('clears per-type counts below two types', () => {
    const next = reconcileQuizConfig(
      cfg({ question_types: ['choice'], per_type_counts: { choice: 3 } }),
    )
    expect(next.per_type_counts).toEqual({})
  })
  it('bumps total to the type count and rebalances', () => {
    const next = reconcileQuizConfig(
      cfg({ num_questions: 2, question_types: ['choice', 'concept', 'coding'] }),
    )
    expect(next.num_questions).toBe(3)
    expect(next.per_type_counts).toEqual({ choice: 1, concept: 1, coding: 1 })
  })
  it('returns the same reference when already consistent', () => {
    const stable = cfg({
      num_questions: 4,
      question_types: ['choice', 'concept'],
      per_type_counts: { choice: 2, concept: 2 },
    })
    expect(reconcileQuizConfig(stable)).toBe(stable)
  })
})

describe('toggleQuestionType', () => {
  it('adds and removes while preserving order', () => {
    expect(toggleQuestionType([], 'choice')).toEqual(['choice'])
    expect(toggleQuestionType(['choice', 'concept'], 'choice')).toEqual(['concept'])
    expect(toggleQuestionType(['choice'], 'concept')).toEqual(['choice', 'concept'])
  })
})

describe('clampQuestionCount', () => {
  it('clamps within mode-specific bounds and guards non-finite input', () => {
    expect(clampQuestionCount(0, 'custom')).toBe(1)
    expect(clampQuestionCount(999, 'custom')).toBe(20)
    expect(clampQuestionCount(999, 'mimic')).toBe(50)
    expect(clampQuestionCount(Number.NaN, 'custom')).toBe(3)
    expect(clampQuestionCount(Number.NaN, 'mimic')).toBe(10)
  })
})

describe('totalTypeCount / typePercentages', () => {
  it('sums selected counts and derives percentages', () => {
    const types = ['choice', 'concept'] as const
    const counts = { choice: 3, concept: 1 }
    expect(totalTypeCount([...types], counts)).toBe(4)
    expect(typePercentages([...types], counts)).toEqual([
      { type: 'choice', count: 3, percent: 75 },
      { type: 'concept', count: 1, percent: 25 },
    ])
  })
})

describe('isQuizConfigSubmittable', () => {
  it('requires paper for mimic and at least one question for custom', () => {
    expect(isQuizConfigSubmittable(cfg({ mode: 'mimic', paper_path: '' }))).toBe(false)
    expect(isQuizConfigSubmittable(cfg({ mode: 'mimic', paper_path: 'p.pdf' }))).toBe(true)
    expect(isQuizConfigSubmittable(cfg({ num_questions: 1 }))).toBe(true)
    expect(isQuizConfigSubmittable(cfg({ num_questions: 0 }))).toBe(false)
  })
})

describe('QUIZ_DIFFICULTIES', () => {
  it('exposes the four difficulty levels', () => {
    expect(QUIZ_DIFFICULTIES).toEqual(['auto', 'easy', 'medium', 'hard'])
  })
})
