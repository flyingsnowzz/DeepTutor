import { describe, expect, it } from 'vitest'
import {
  groupSubagentEvents,
  subagentIdentity,
  visibleSubagentEvents,
} from '../subagentTrace'

const subagent = (content: string, metadata: Record<string, unknown>) => ({
  type: 'progress',
  content,
  metadata: { trace_kind: 'subagent_event', ...metadata },
})

describe('subagent trace', () => {
  it('groups consults by turn and collapses merge ids to the latest content', () => {
    const groups = groupSubagentEvents([
      { events: [
        subagent('question', { turn_id: 't1', subagent_name: 'Codex', subagent_channel: 'question' }),
        subagent('search', { turn_id: 't1', subagent_name: 'Codex', subagent_channel: 'tool', subagent_merge_id: '1:search' }),
        subagent('search docs', { turn_id: 't1', subagent_name: 'Codex', subagent_channel: 'tool', subagent_merge_id: '1:search' }),
      ] },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.label).toBe('Codex')
    expect(visibleSubagentEvents(groups[0]!.events).map(event => event.content)).toEqual(['question', 'search docs'])
  })

  it('reads partner and group consultation identities', () => {
    expect(subagentIdentity([
      subagent('x', { subagent_name: 'Group', subagent_kind: 'partner_group', partner_group_id: 'g1', partner_group_session_key: 'discussion-1' }),
    ])).toMatchObject({ name: 'Group', kind: 'partner_group', groupId: 'g1', groupSessionKey: 'discussion-1' })
  })
})
