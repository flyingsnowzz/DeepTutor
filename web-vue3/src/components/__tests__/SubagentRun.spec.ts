import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SubagentRunTranscript from '../SubagentRunTranscript.vue'
import SubagentTabBody from '../SubagentTabBody.vue'

const event = (content: string, channel: string, extra: Record<string, unknown> = {}) => ({
  type: 'progress',
  content,
  metadata: {
    trace_kind: 'subagent_event',
    subagent_channel: channel,
    subagent_name: 'Codex',
    subagent_kind: 'codex',
    ...extra,
  },
})

describe('subagent run pages', () => {
  it('renders a CLI-style transcript and collapses merge ids', () => {
    const wrapper = mount(SubagentRunTranscript, {
      props: {
        events: [
          event('Question', 'question'),
          event('Searching', 'tool', { subagent_merge_id: '1:search' }),
          event('Searching docs', 'tool', { subagent_merge_id: '1:search' }),
          event('Line 1\nLine 2\nLine 3\nLine 4', 'tool_result'),
        ],
      },
    })
    expect(wrapper.text()).toContain('DeepTutor 问')
    expect(wrapper.text()).toContain('Searching docs')
    expect(wrapper.text()).not.toContain('SearchingQuestion')
    expect(wrapper.get('.subagent-tool-result summary').text()).toBe('工具输出')
  })

  it('offers direct messaging only for a connected subagent', () => {
    const wrapper = mount(SubagentTabBody, {
      props: {
        events: [event('Question', 'question')],
        sessionId: 's1',
      },
      global: { stubs: { LegacyIcon: true } },
    })
    expect(wrapper.find('.subagent-direct-composer').exists()).toBe(true)
    expect(wrapper.get('textarea').attributes('placeholder')).toContain('Codex')
  })
})
