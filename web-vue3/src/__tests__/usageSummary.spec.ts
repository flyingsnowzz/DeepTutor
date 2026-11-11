import { describe, expect, it } from 'vitest'
import { combineUsage, cumulativeMessageUsage, messageUsage, type UsageSummary } from '../usageSummary'

const turn: UsageSummary = { total_tokens: 140, prompt_tokens: 100, completion_tokens: 40, total_calls: 1, cache_read_input_tokens: 80, cache_input_tokens: 100, cache_reported_calls: 1, cache_hit_rate: 0.8, ttft_seconds: 2, ttft_calls: 1, generation_seconds: 2, timed_completion_tokens: 40, tokens_per_second: 20 }
const other: UsageSummary = { ...turn, total_tokens: 1040, prompt_tokens: 1000, cache_input_tokens: 1000, cache_read_input_tokens: 100, cache_hit_rate: 0.1, ttft_seconds: 4, ttft_calls: 2, generation_seconds: 8, timed_completion_tokens: 160 }
const event = (type: string, metadata: Record<string, unknown>) => ({ type, metadata })

describe('usage summary', () => {
  it('weights cache and generation rates by their correct denominators', () => {
    const all = combineUsage([turn, other])
    expect(all.cache_hit_rate).toBeCloseTo(180 / 1100)
    expect(all.ttft_seconds).toBeCloseTo(10 / 3)
    expect(all.tokens_per_second).toBe(20)
  })

  it('deduplicates result snapshots with done and keeps legacy cost summaries', () => {
    expect(messageUsage([event('result', { metadata: { usage_summary: turn } }), event('done', { usage_summary: turn }), event('result', { metadata: { usage_summary: other } }), event('done', { usage_summary: other })])?.total_tokens).toBe(1180)
    const legacy = messageUsage([event('result', { metadata: { cost_summary: { total_tokens: 200, total_calls: 2 } } })])
    expect(legacy?.total_tokens).toBe(200)
    expect(legacy?.cache_hit_rate).toBeNull()
  })

  it('keeps cumulative session totals at each visible reply', () => {
    const totals = cumulativeMessageUsage([turn, other, turn].map(usage => ({ role: 'assistant', events: [event('done', { usage_summary: usage })] })))
    expect(totals.map(usage => usage.total_tokens)).toEqual([140, 1180, 1320])
    expect(totals[0].cache_hit_rate).toBe(0.8)
  })
})
