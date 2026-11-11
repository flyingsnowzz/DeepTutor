import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import ChatPage from '../ChatPage.vue'
import { api } from '../../api'
import { useRoute, useRouter } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: vi.fn(), useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const route = reactive<any>({ path: '/chat/s1', params: { sessionId: 's1' }, query: {} })

describe('chat message operations', () => {
  beforeEach(() => {
    apiMock.mockReset(); route.params = { sessionId: 's1' }
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace: vi.fn() } as unknown as ReturnType<typeof useRouter>)
    const session = { id: 's1', title: 'Branches', preferences: { selected_branches: { '2': 5 } }, messages: [
      { id: 1, role: 'user', content: 'First', parent_message_id: null },
      { id: 2, role: 'assistant', content: 'Answer', parent_message_id: 1 },
      { id: 3, role: 'user', content: 'Original', parent_message_id: 2 },
      { id: 4, role: 'assistant', content: 'Original answer', parent_message_id: 3 },
      { id: 5, role: 'user', content: 'Edited', parent_message_id: 2 },
      { id: 6, role: 'assistant', content: 'Edited answer', parent_message_id: 5 },
    ] }
    apiMock.mockImplementation(async path => {
      const value = String(path)
      if (value === '/api/sessions/s1') return session
      if (value.startsWith('/api/sessions?')) return { sessions: [{ id: 's1', title: 'Branches' }] }
      if (value === '/api/capabilities/registered') return []
      if (value === '/api/knowledge-bases/list') return []
      if (value === '/api/personas') return { personas: [] }
      if (value === '/api/skills/list') return { skills: [] }
      if (value === '/api/space/mcp/servers') return { servers: {} }
      if (value === '/api/notebooks') return { notebooks: [] }
      if (value === '/api/partners') return []
      return {}
    })
  })

  it('switches and persists a branch, then confirms deletion of its turn', async () => {
    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.findAll('[data-chat-message-id]').map(node => Number(node.attributes('data-chat-message-id')))).toEqual([1, 2, 5, 6])
    expect(wrapper.text()).toContain('Edited answer')
    expect(wrapper.text()).not.toContain('Original answer')
    await wrapper.get('button[aria-label="上一个分支"]').trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/sessions/s1/branch-selection', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ selected_branches: { '2': 3 } }) }))
    expect(wrapper.findAll('[data-chat-message-id]').map(node => Number(node.attributes('data-chat-message-id')))).toEqual([1, 2, 3, 4])
    expect(wrapper.text()).toContain('Original answer')

    const deleteButtons = wrapper.findAll('button[aria-label="删除本轮对话"]')
    await deleteButtons[deleteButtons.length - 1].trigger('click')
    expect(apiMock.mock.calls.some(call => String(call[0]).endsWith('/messages/3'))).toBe(false)
    await wrapper.get('.chat-delete-confirm .danger').trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/sessions/s1/messages/3', { method: 'DELETE' })
  })
})
