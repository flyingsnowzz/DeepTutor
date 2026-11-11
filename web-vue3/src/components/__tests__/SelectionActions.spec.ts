import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SelectionActions from '../SelectionActions.vue'

describe('SelectionActions', () => {
  it('adds a selection to the main chat and opens Dito or another responder', async () => {
    const wrapper = mount(SelectionActions, {
      props: {
        anchor: { left: 100, right: 220, top: 80, bottom: 110 },
        agents: [{ name: 'Research Agent', kind: 'claude_code' }],
        partners: [{ partner_id: 'p1', name: 'Partner One' }],
        groups: [{ group_id: 'g1', name: 'Study Group', emoji: '👥' }],
      },
      global: { stubs: { PartnerAvatar: true, AgentGlyph: true, LegacyIcon: true } },
    })
    await wrapper.findAll('button')[0].trigger('click')
    expect(wrapper.emitted('add')).toHaveLength(1)

    await wrapper.findAll('button')[1].trigger('click')
    expect(wrapper.emitted('ask')?.[0]).toEqual([{ kind: 'dito' }])

    await wrapper.findAll('button')[2].trigger('click')
    await wrapper.findAll('[role="menuitem"]')[0].trigger('click')
    expect(wrapper.emitted('ask')?.[1]).toEqual([
      { kind: 'subagent', id: 'Research Agent', name: 'Research Agent' },
    ])
  })
})
