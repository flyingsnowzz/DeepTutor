import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatHistoryPage from '../ChatHistoryPage.vue'
import { api } from '../../api'
import { useRoute, useRouter } from 'vue-router'
import { reactive } from 'vue'

vi.mock('../../api', () => ({ api: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: vi.fn(), useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const push = vi.fn()
const route = reactive<any>({ path: '/chat/history', params: {}, query: {}, fullPath: '/chat/history' })
const mastery = { id: 'm1', session_id: 'm1', title: 'Mastery', updated_at: 10, content_workspace_id: 'class', preferences: { workspace_mode: 'mastery_path', mastery_path_id: 'p1', pinned: true } }
const archived = { id: 'a1', title: 'Archived', updated_at: 20, preferences: { archived: true } }

describe('ChatHistoryPage', () => {
  beforeEach(() => {
    apiMock.mockReset(); push.mockReset(); route.query = {}
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async path => {
      if (String(path).startsWith('/api/sessions?')) return { sessions: [archived, mastery] }
      if (String(path).startsWith('/api/sessions/search')) return { sessions: [mastery], total: 1 }
      return {}
    })
  })
  afterEach(() => { vi.useRealTimers() })

  it('sorts pinned sessions, filters archive state and restores the owning surface', async () => {
    const wrapper = mount(ChatHistoryPage)
    await flushPromises()
    expect(wrapper.findAll('.history-row')).toHaveLength(1)
    await wrapper.get('.history-title').trigger('click')
    expect(push).toHaveBeenCalledWith('/learning/mastery/p1/sessions/m1?dt_workspace=class')
    await wrapper.get('select[aria-label="按归档状态筛选"]').setValue('archived')
    expect(wrapper.text()).toContain('Archived')
    expect(wrapper.text()).not.toContain('Mastery')
  })

  it('debounces content search and renders server results', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ChatHistoryPage)
    await flushPromises()
    await wrapper.get('input[type="search"]').setValue('vectors')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('/api/sessions/search?q=vectors'))
    expect(wrapper.text()).toContain('Mastery')
    expect(wrapper.text()).not.toContain('Archived')
  })

  it('confirms permanent deletion once and removes the row', async () => {
    const confirmMock = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmMock)
    const wrapper = mount(ChatHistoryPage)
    await flushPromises()
    await wrapper.get('.history-actions-trigger').trigger('click')
    await wrapper.findAll('[role="menuitem"]').find(item => item.text() === '删除对话')?.trigger('click')
    expect(confirmMock).toHaveBeenCalledWith('永久删除此对话及其导师子对话？此操作无法撤销。')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/sessions/m1?dt_workspace=class', { method: 'DELETE' })
    expect(wrapper.text()).toContain('没有匹配的会话')
  })
})
