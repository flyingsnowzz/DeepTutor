/**
 * Subagent consult budget — the maximum number of times a turn may consult a
 * connected subagent ("max rounds"). Port of the Budget stepper in
 * web/components/chat/home/AnswerModeMenu.tsx and the backend bounds in
 * deeptutor/services/subagent/config.py (CONSULT_BUDGET_MIN/MAX, default 5).
 * Pure functions so the clamp/step logic is unit-testable.
 */

export const CONSULT_BUDGET_MIN = 1
export const CONSULT_BUDGET_MAX = 12
export const DEFAULT_CONSULT_BUDGET = 5

/** Clamp an arbitrary value into the supported budget window. */
export function clampBudget(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_CONSULT_BUDGET
  return Math.max(CONSULT_BUDGET_MIN, Math.min(CONSULT_BUDGET_MAX, Math.round(n)))
}

/** One step down, floored at the minimum. */
export function decreaseBudget(value: number | null): number {
  const current = value ?? DEFAULT_CONSULT_BUDGET
  return Math.max(CONSULT_BUDGET_MIN, current - 1)
}

/** One step up, capped at the maximum. */
export function increaseBudget(value: number | null): number {
  const current = value ?? DEFAULT_CONSULT_BUDGET
  return Math.min(CONSULT_BUDGET_MAX, current + 1)
}

export function canDecrease(value: number | null): boolean {
  return (value ?? DEFAULT_CONSULT_BUDGET) > CONSULT_BUDGET_MIN
}

export function canIncrease(value: number | null): boolean {
  return (value ?? DEFAULT_CONSULT_BUDGET) < CONSULT_BUDGET_MAX
}

/** The value shown in the stepper; null budget renders as an en dash. */
export function displayBudget(value: number | null): string {
  return value == null ? '–' : String(value)
}
