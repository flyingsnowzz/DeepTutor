import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import ChatPage from '../ChatPage.vue'
import { api } from '../../api'
import { useRoute, useRouter } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: vi.fn(), useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const route = reactive<any>({ path: '/learning/mastery/p1/sessions/s1', params: { pathId: 'p1', sessionId: 's1' }, query: {} })
const replace = vi.fn()
const topic = {
  path_id: 'p1', name: 'Linear algebra', metadata: { goal: 'Learn linear algebra' },
  next: { knowledge_point_id: 'k2', knowledge_point_name: 'Matrices' },
  map: { complete: false, counts: { mastered: 1, total: 2 }, modules: [{ id: 'm1', name: 'Foundations', knowledge_points: [{ id: 'k1', name: 'Vectors', status: 'mastered' }, { id: 'k2', name: 'Matrices', status: 'learning' }] }] },
}

describe('Mastery study workspace', () => {
  beforeEach(() => {
    apiMock.mockReset(); replace.mockReset(); localStorage.clear(); sessionStorage.clear()
    route.path = '/learning/mastery/p1/sessions/s1'; route.params = { pathId: 'p1', sessionId: 's1' }; route.query = {}
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async (path, init) => {
      const value = String(path)
      if (value === '/api/mastery-paths/topics/p1') return structuredClone(topic)
      if (value === '/api/mastery-paths/topics/p1/sessions') return { sessions: [{ session_id: 's1', title: 'Matrices' }] }
      if (value === '/api/sessions/s1') return { id: 's1', title: 'Matrices', messages: [{ id: 1, role: 'assistant', content: 'A matrix is a linear map.' }], preferences: { mastery_session_mode: 'study' } }
      if (value.startsWith('/api/mastery-paths/topics/p1/ask-hint')) return { hint: 'How does a matrix transform a vector?' }
      if (value.endsWith('/sessions/s1/mode')) return { session_id: 's1', mode: JSON.parse(String(init?.body)).mode }
      if (value === '/api/knowledge-bases/list') return []
      if (value === '/api/personas') return { personas: [] }
      if (value === '/api/skills/list') return { skills: [] }
      if (value === '/api/space/mcp/servers') return { servers: {} }
      if (value === '/api/notebooks') return { notebooks: [] }
      if (value === '/api/capabilities/registered') return []
      if (value === '/api/partners') return []
      return {}
    })
  })

  it('matches the legacy header, persistent outline, hint and mode request', async () => {
    const wrapper = mount(ChatPage, { props: { mastery: true }, global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.get('.mastery-study-location').text()).toContain('Linear algebra')
    expect(wrapper.get('.mastery-study-location').text()).toContain('Matrices')
    expect(wrapper.findAll('.mastery-study-point')).toHaveLength(2)
    expect(wrapper.get('.mastery-study-point.current').text()).toBe('Matrices')
    expect(wrapper.get('textarea').attributes('placeholder')).toBe('How does a matrix transform a vector?')
    expect(wrapper.get('.mastery-study-progress').text()).toBe('1/2')
    expect(wrapper.get('button[aria-label="保存到收藏夹"]').attributes('disabled')).toBeUndefined()

    await wrapper.get('button[aria-label="隐藏大纲"]').trigger('click')
    expect(localStorage.getItem('dt.mastery.outline')).toBe('0')
    expect(wrapper.get('.mastery-study-rail').classes()).toContain('is-collapsed')
    await wrapper.get('button[aria-label="显示大纲"]').trigger('click')
    expect(localStorage.getItem('dt.mastery.outline')).toBe('1')

    await wrapper.get('button[title="复习"]').trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/mastery-paths/topics/p1/sessions/s1/mode', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ mode: 'review' }) }))
    expect(wrapper.get('.mastery-mode-note').text()).toContain('重新检测')
    expect(wrapper.get('button[title="复习"]').attributes('aria-pressed')).toBe('true')

    await wrapper.get('button[aria-label="活动"]').trigger('click')
    expect(wrapper.get('.activity-panel').isVisible()).toBe(true)
  })

  it('offers the three mode-specific empty starters for a new session', async () => {
    route.path = '/learning/mastery/p1/sessions'; route.params = { pathId: 'p1' }
    const wrapper = mount(ChatPage, { props: { mastery: true }, global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.get('.mastery-empty-study h2').text()).toBe('Matrices')
    expect(wrapper.findAll('.mastery-study-starters button')).toHaveLength(3)
    expect(wrapper.get('.mastery-study-starters').text()).toContain('快速检测')
    await wrapper.get('button[title="复习"]').trigger('click')
    await flushPromises()
    expect(replace).toHaveBeenCalledWith({ path: '/learning/mastery/p1/sessions', query: { mode: 'review' } })
    expect(wrapper.get('.mastery-empty-study h2').text()).toBe('回顾你已经掌握的内容')
  })
})
