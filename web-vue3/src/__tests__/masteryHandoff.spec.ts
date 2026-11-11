import { describe, expect, it } from 'vitest'
import { extractMasteryHandoffs, masteryHandoffFrom, masteryHandoffHref } from '../masteryHandoff'

const event = {
  type: 'tool_result',
  metadata: {
    tool_metadata: {
      mastery_handoff: {
        kind: 'open',
        path_id: 'p1',
        path_name: 'Algebra',
        session_id: 's1',
        opening_message: 'Review equations',
        mastered: 3,
        objectives: 8,
      },
    },
  },
}

describe('mastery handoff signals', () => {
  it('extracts, dedupes and routes handoff cards', () => {
    const payload = masteryHandoffFrom(event)
    expect(payload).toMatchObject({ kind: 'open', path_id: 'p1', mastered: 3, objectives: 8 })
    expect(masteryHandoffHref(payload!)).toBe('/learning/mastery/p1/sessions/s1')
    expect(extractMasteryHandoffs([event, event, { ...event, metadata: { tool_metadata: { mastery_handoff: { ...event.metadata.tool_metadata.mastery_handoff, kind: 'new', session_id: '' } } } }])).toHaveLength(2)
    expect(masteryHandoffFrom({ type: 'tool_result', metadata: { tool_metadata: { mastery_handoff: { kind: 'open', path_id: 'p2' } } } })).toBeNull()
  })
})
