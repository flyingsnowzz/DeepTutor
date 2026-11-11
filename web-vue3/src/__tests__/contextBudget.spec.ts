import { describe, expect, it } from 'vitest'
import { latestContextBudget, readContextBudget } from '../contextBudget'

const budget = { window: 1000, used_tokens: 400, free_tokens: 600, segments: [{ key: 'messages', tokens: 400 }] }
const result = (value: unknown) => ({ type: 'result', metadata: { metadata: { context_budget: value } } })

describe('context budget', () => {
  it('uses the newest valid result measurement within a message', () => {
    expect(readContextBudget([result(budget), result({ ...budget, used_tokens: 500 })])).toMatchObject({ used_tokens: 500 })
    expect(readContextBudget([{ type: 'done', metadata: { context_budget: budget } }])).toBeNull()
  })

  it('keeps the last completed assistant measurement when a newer turn has no result', () => {
    const messages = [{ role: 'assistant', events: [result(budget)] }, { role: 'assistant', events: [] }]
    expect(latestContextBudget(messages)).toEqual(budget)
    expect(latestContextBudget([{ role: 'user', events: [result(budget)] }])).toBeNull()
  })
})
