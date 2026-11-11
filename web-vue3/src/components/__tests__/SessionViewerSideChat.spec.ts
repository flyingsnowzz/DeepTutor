import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SessionViewerPanel from '../SessionViewerPanel.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn() }))
const apiMock = vi.mocked(api)

describe('SessionViewerPanel side chats', () => {
  beforeEach(() => {
    apiMock.mockReset()
    apiMock.mockImplementation(async path => {
      if (path === '/api/sessions/s1/threads') {
        return {
          threads: [{
            session_id: 'side-existing',
            title: 'Earlier side chat',
            preferences: { answer_by: 'partner:p1' },
          }],
        }
      }
      return {}
    })
    localStorage.clear()
  })

  it('opens a new side chat from the viewer launcher', async () => {
    const wrapper = mount(SessionViewerPanel, {
      props: {
        open: true,
        note: '',
        sessionId: 's1',
        sessionTitle: 'Main conversation',
        attachmentHref: () => '',
      },
      global: { stubs: { SideChatPanel: { template: '<div data-test="side-chat" />' } } },
    })
    await wrapper.get('button[aria-label="新建标签页"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Earlier side chat')
    await wrapper.findAll('button').find(button => button.text().includes('侧边对话'))?.trigger('click')
    expect(wrapper.find('[data-test="side-chat"]').exists()).toBe(true)
  })

  it('reopens a persisted side-chat thread from history', async () => {
    const wrapper = mount(SessionViewerPanel, {
      props: {
        open: true,
        note: '',
        sessionId: 's1',
        sessionTitle: 'Main conversation',
        attachmentHref: () => '',
      },
      global: { stubs: { SideChatPanel: { template: '<div data-test="side-chat" />' } } },
    })
    await wrapper.get('button[aria-label="新建标签页"]').trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text().includes('Earlier side chat'))?.trigger('click')
    expect(wrapper.find('[data-test="side-chat"]').exists()).toBe(true)
  })

  it('opens and updates a connected subagent run tab', async () => {
    const wrapper = mount(SessionViewerPanel, {
      props: {
        open: true,
        note: '',
        sessionId: 's1',
        attachmentHref: () => '',
      },
    })
    const event = {
      type: 'progress',
      content: 'Reviewing',
      metadata: {
        trace_kind: 'subagent_event',
        subagent_name: 'Codex',
        subagent_kind: 'codex',
        subagent_channel: 'question',
      },
    }
    ;(wrapper.vm as unknown as {
      openSubagentTab: (key: string, label: string, events: typeof event[]) => void
    }).openSubagentTab('turn-1', 'Codex', [event])
    await flushPromises()
    expect(wrapper.find('.subagent-tab').exists()).toBe(true)
    expect(wrapper.text()).toContain('Reviewing')
  })
})
