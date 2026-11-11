import { describe, expect, it } from 'vitest'
import {
  canDecrease,
  canIncrease,
  clampBudget,
  CONSULT_BUDGET_MAX,
  CONSULT_BUDGET_MIN,
  decreaseBudget,
  DEFAULT_CONSULT_BUDGET,
  displayBudget,
  increaseBudget,
} from '../subagentBudget'

describe('clampBudget', () => {
  it('keeps in-range integers', () => {
    expect(clampBudget(3)).toBe(3)
    expect(clampBudget('7')).toBe(7)
  })

  it('clamps to the 1–12 window and rounds', () => {
    expect(clampBudget(0)).toBe(CONSULT_BUDGET_MIN)
    expect(clampBudget(99)).toBe(CONSULT_BUDGET_MAX)
    expect(clampBudget(4.6)).toBe(5)
  })

  it('falls back to the default for non-finite input', () => {
    expect(clampBudget(undefined)).toBe(DEFAULT_CONSULT_BUDGET)
    expect(clampBudget('abc')).toBe(DEFAULT_CONSULT_BUDGET)
  })
})

describe('step helpers', () => {
  it('decreases and increases with bounds', () => {
    expect(decreaseBudget(5)).toBe(4)
    expect(increaseBudget(5)).toBe(6)
    expect(decreaseBudget(CONSULT_BUDGET_MIN)).toBe(CONSULT_BUDGET_MIN)
    expect(increaseBudget(CONSULT_BUDGET_MAX)).toBe(CONSULT_BUDGET_MAX)
  })

  it('treats null as the default when stepping', () => {
    expect(decreaseBudget(null)).toBe(DEFAULT_CONSULT_BUDGET - 1)
    expect(increaseBudget(null)).toBe(DEFAULT_CONSULT_BUDGET + 1)
  })
})

describe('availability flags', () => {
  it('reports whether each direction is available', () => {
    expect(canDecrease(1)).toBe(false)
    expect(canDecrease(null)).toBe(true)
    expect(canIncrease(12)).toBe(false)
    expect(canIncrease(8)).toBe(true)
  })
})

describe('displayBudget', () => {
  it('renders an en dash for null and a string otherwise', () => {
    expect(displayBudget(null)).toBe('–')
    expect(displayBudget(5)).toBe('5')
  })
})
