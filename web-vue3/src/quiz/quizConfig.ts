/**
 * Quiz configuration helpers — Vue3 port of the pure logic in
 * web/components/quiz/QuizConfigPanel.tsx (rebalanceCounts + the
 * selected-type/count reconciliation effect).
 */
import type { NormalizedQuizQuestionType } from './questionType'
import type { DeepQuestionFormConfig } from './quizModel'

export const QUIZ_DIFFICULTIES = ['auto', 'easy', 'medium', 'hard'] as const
export type QuizDifficulty = (typeof QUIZ_DIFFICULTIES)[number]

export const QUIZ_NUM_MIN = 1
export const QUIZ_NUM_MAX = 20
export const QUIZ_MIMIC_MAX = 50

/** Per-type accent colors, matching the React ratio bar legend. */
export const QUIZ_TYPE_ACCENT: Record<NormalizedQuizQuestionType, string> = {
  choice: '#f97316',
  concept: '#10b981',
  fill_in_blank: '#0ea5e9',
  short_answer: '#8b5cf6',
  written: '#f43f5e',
  coding: '#64748b',
}

/**
 * Re-distribute the total quiz count across the selected types. Each
 * selected type gets at least 1; the remainder lands on the first types in
 * ``types`` order. Existing counts are preserved when they still sum to the
 * effective total and are all ≥ 1; otherwise a clean equal split replaces them.
 */
export function rebalanceCounts(
  types: NormalizedQuizQuestionType[],
  total: number,
  prev: Partial<Record<NormalizedQuizQuestionType, number>>,
): Partial<Record<NormalizedQuizQuestionType, number>> {
  if (types.length < 2) return {}
  const safeTotal = Math.max(types.length, Math.floor(total))
  const preserved: Partial<Record<NormalizedQuizQuestionType, number>> = {}
  let preservedSum = 0
  let preservedValid = true
  for (const type of types) {
    const value = prev[type]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
      preservedValid = false
      break
    }
    preserved[type] = Math.floor(value)
    preservedSum += preserved[type]
  }
  if (preservedValid && preservedSum === safeTotal) return preserved

  const base = Math.floor(safeTotal / types.length)
  let remainder = safeTotal - base * types.length
  const out: Partial<Record<NormalizedQuizQuestionType, number>> = {}
  for (const type of types) {
    out[type] = base + (remainder > 0 ? 1 : 0)
    if (remainder > 0) remainder -= 1
  }
  return out
}

export function countsEqual(
  a: Partial<Record<NormalizedQuizQuestionType, number>>,
  b: Partial<Record<NormalizedQuizQuestionType, number>>,
): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(key => a[key as NormalizedQuizQuestionType] === b[key as NormalizedQuizQuestionType])
}

/**
 * Reconcile a custom quiz config after a type/count edit:
 * - fewer than 2 types clears per-type counts;
 * - ≥2 types bump num_questions to at least the type count;
 * - counts are rebalanced to the effective total.
 * Returns the same object reference when nothing changes, so callers can
 * avoid redundant updates/emits.
 */
export function reconcileQuizConfig(cfg: DeepQuestionFormConfig): DeepQuestionFormConfig {
  if (cfg.mode !== 'custom') return cfg
  if (cfg.question_types.length < 2) {
    return Object.keys(cfg.per_type_counts).length > 0
      ? { ...cfg, per_type_counts: {} }
      : cfg
  }
  const total = Math.max(cfg.num_questions, cfg.question_types.length)
  const next = rebalanceCounts(cfg.question_types, total, cfg.per_type_counts)
  if (total === cfg.num_questions && countsEqual(next, cfg.per_type_counts)) return cfg
  return { ...cfg, num_questions: total, per_type_counts: next }
}

/** Toggle a question type in/out of the allowed set, preserving order. */
export function toggleQuestionType(
  types: NormalizedQuizQuestionType[],
  type: NormalizedQuizQuestionType,
): NormalizedQuizQuestionType[] {
  return types.includes(type) ? types.filter(item => item !== type) : [...types, type]
}

/** Clamp the requested question count for the active mode. */
export function clampQuestionCount(value: number, mode: DeepQuestionFormConfig['mode']): number {
  const max = mode === 'mimic' ? QUIZ_MIMIC_MAX : QUIZ_NUM_MAX
  if (!Number.isFinite(value)) return mode === 'mimic' ? 10 : 3
  return Math.max(QUIZ_NUM_MIN, Math.min(Math.floor(value), max))
}

/** Total of the per-type counts, ignoring unselected keys. */
export function totalTypeCount(
  types: NormalizedQuizQuestionType[],
  counts: Partial<Record<NormalizedQuizQuestionType, number>>,
): number {
  return types.reduce((sum, type) => sum + (counts[type] ?? 0), 0)
}

/** Percentage splits for the ratio bar (rounded, sums to the total). */
export function typePercentages(
  types: NormalizedQuizQuestionType[],
  counts: Partial<Record<NormalizedQuizQuestionType, number>>,
): Array<{ type: NormalizedQuizQuestionType; count: number; percent: number }> {
  const total = totalTypeCount(types, counts)
  return types.map(type => {
    const count = counts[type] ?? 0
    return { type, count, percent: total > 0 ? (count / total) * 100 : 0 }
  })
}

/** Validate that a custom config can be submitted. */
export function isQuizConfigSubmittable(cfg: DeepQuestionFormConfig): boolean {
  if (cfg.mode === 'mimic') return cfg.paper_path.trim().length > 0
  return cfg.num_questions >= 1
}
