import { describe, expect, it } from 'vitest'
import {
  detectStreamingMode,
  getCallProvider,
  getToolProvider,
  getTraceCallKind,
  groupHasTraceSubstance,
  groupTraceEvents,
  hasRenderableCallTrace,
  hasSettledFinalRound,
  isTracePending,
  selectTraceDisplayItems,
  type TraceEvent,
} from '../traceSelectors'

function event(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return { type: 'progress', content: '', ...overrides }
}
function withCall(callId: string, meta: Record<string, unknown>, rest: Partial<TraceEvent> = {}): TraceEvent {
  return event({ metadata: { call_id: callId, ...meta }, ...rest })
}

describe('groupTraceEvents', () => {
  it('groups events by call_id and preserves order', () => {
    const events = [
      withCall('a', {}),
      withCall('b', {}),
      withCall('a', { call_state: 'complete' }),
    ]
    const groups = groupTraceEvents(events)
    expect(groups.map(g => g.callId)).toEqual(['a', 'b'])
    expect(groups[0].events).toHaveLength(2)
  })

  it('ignores events without a call_id', () => {
    expect(groupTraceEvents([event({ metadata: {} })]),).toEqual([])
  })
})

describe('metadata readers', () => {
  it('reads call kind and provider from nested tool_metadata', () => {
    const events = [withCall('a', { call_kind: 'llm_reasoning', tool_metadata: { provider: 'perplexity' } })]
    expect(getTraceCallKind(events)).toBe('llm_reasoning')
    expect(getCallProvider(events)).toBe('perplexity')
  })

  it('ignores "none" provider and falls back to top-level', () => {
    expect(getCallProvider([withCall('a', { provider: 'lightrag' })])).toBe('lightrag')
    expect(getCallProvider([withCall('a', { provider: 'none' })])).toBe('')
  })

  it('reads tool source/provider', () => {
    expect(getToolProvider([withCall('a', { tool_source: 'web', tool_provider: 'p' })])).toEqual({
      source: 'web',
      id: 'p',
    })
  })
})

describe('isTracePending', () => {
  it('is pending only while running without a terminal state', () => {
    expect(isTracePending([withCall('a', { call_state: 'running' })])).toBe(true)
    expect(
      isTracePending([withCall('a', { call_state: 'running' }), withCall('a', { call_state: 'complete' })]),
    ).toBe(false)
  })
})

describe('groupHasTraceSubstance', () => {
  it('treats tool calls/results/errors as substance', () => {
    expect(groupHasTraceSubstance([event({ type: 'tool_call' })])).toBe(true)
    expect(groupHasTraceSubstance([event({ type: 'error' })])).toBe(true)
  })

  it('rejects empty thinking and call_status-only progress', () => {
    expect(groupHasTraceSubstance([event({ type: 'thinking', content: '  ' })])).toBe(false)
    expect(
      groupHasTraceSubstance([event({ type: 'progress', content: 'x', metadata: { trace_kind: 'call_status' } })]),
    ).toBe(false)
    expect(
      groupHasTraceSubstance([event({ type: 'progress', content: 'working', metadata: { trace_kind: 'tool_progress' } })]),
    ).toBe(true)
  })
})

describe('selectTraceDisplayItems', () => {
  it('drops final-response, absorbed, and substance-free groups', () => {
    const events = [
      withCall('final', { call_kind: 'llm_final_response' }, { type: 'content', content: 'answer' }),
      withCall('absorbed', { absorbed_into_final: true }, { type: 'tool_call' }),
      withCall('empty', {}, { type: 'thinking', content: '' }),
      withCall('real', {}, { type: 'tool_call' }),
    ]
    const items = selectTraceDisplayItems(groupTraceEvents(events))
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('trace')
  })

  it('folds react_round groups sharing a step_id into one step', () => {
    const events = [
      withCall('a', { trace_group: 'react_round', step_id: 's1' }, { type: 'tool_call' }),
      withCall('b', { trace_group: 'react_round', step_id: 's1' }, { type: 'tool_result' }),
    ]
    const items = selectTraceDisplayItems(groupTraceEvents(events))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'step', stepId: 's1' })
    if (items[0].kind === 'step') expect(items[0].traces).toHaveLength(2)
  })

  it('exposes renderability check', () => {
    expect(hasRenderableCallTrace([withCall('a', {}, { type: 'tool_call' })])).toBe(true)
    expect(hasRenderableCallTrace([event({ metadata: {} })])).toBe(false)
  })
})

describe('hasSettledFinalRound', () => {
  it('true only when the latest call_status is a finished finish role', () => {
    expect(
      hasSettledFinalRound([withCall('a', { trace_kind: 'call_status', call_state: 'complete', call_role: 'finish' })]),
    ).toBe(true)
    expect(
      hasSettledFinalRound([withCall('a', { trace_kind: 'call_status', call_state: 'complete', call_role: 'continue' })]),
    ).toBe(false)
  })
})

describe('detectStreamingMode', () => {
  it('returns responded when not streaming and maps live event types', () => {
    expect(detectStreamingMode([], false, false)).toBe('responded')
    expect(detectStreamingMode([event({ type: 'tool_call' })], false, true)).toBe('tool_using')
    expect(detectStreamingMode([event({ type: 'tool_call', stage: 'exploring' })], false, true)).toBe('exploring')
    expect(
      detectStreamingMode([event({ type: 'thinking', metadata: { call_kind: 'llm_reasoning' } })], false, true),
    ).toBe('reasoning')
    expect(
      detectStreamingMode(
        [event({ type: 'content', metadata: { call_kind: 'llm_planning' } })],
        true,
        true,
      ),
    ).toBe('planning')
  })
})
