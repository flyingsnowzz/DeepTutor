import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MemoryPage from '../MemoryPage.vue'
import { api, post } from '../../api'
import { useRoute } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const route = { path: '/memory/l2/chat', fullPath: '/memory/l2/chat?focus=m_00000000000000000000000000', params: { surface: 'chat' }, query: { focus: 'm_00000000000000000000000000' } }
const entry = 'm_00000000000000000000000000'

describe('MemoryPage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiMock.mockReset(); postMock.mockReset()
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    apiMock.mockImplementation(async path => {
      if (path === '/api/memory/overview') return { docs: [{ layer: 'L2', key: 'chat', exists: true, updated_at: 'now', entry_count: 1, backlog: 0 }] }
      if (path === '/api/memory/doc/L2/chat') return { content: `# Chat\n\n- Summary <!--${entry}-->` }
      if (path === '/api/memory/doc/L2/chat/lines') return { lines: [{ number: 1, kind: 'title', text: '# Chat' }] }
      return {}
    })
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => { vi.useRealTimers() })

  it('renders markdown, highlights a deep-linked entry once and saves edits', async () => {
    const wrapper = mount(MemoryPage, { attachTo: document.body, global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(100)
    expect(document.getElementById(entry)).not.toBeNull()
    expect(document.querySelector('.memory-entry-focused')).not.toBeNull()
    await wrapper.get('button[aria-label="编辑"]').trigger('click')
    await wrapper.get('textarea').setValue('# Updated')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/memory/doc/L2/chat', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ content: '# Updated' }) }))
    expect(wrapper.text()).toContain('文档已保存')
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('polls a memory maintenance run to completion', async () => {
    postMock.mockResolvedValue({ run_id: 'run1', status: 'running' })
    apiMock.mockImplementation(async path => {
      if (path === '/api/memory/overview') return { docs: [] }
      if (path === '/api/memory/doc/L2/chat') return { content: '' }
      if (path === '/api/memory/doc/L2/chat/lines') return { lines: [] }
      if (path === '/api/memory/runs/run1') return { run_id: 'run1', status: 'completed' }
      return {}
    })
    const wrapper = mount(MemoryPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('.memory-run-start').trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/memory/runs/start', { layer: 'L2', key: 'chat', mode: 'update', budget: 20, iterations: null, llm_selection: null, language: 'zh' })
    expect(wrapper.text()).toContain('整理任务：completed')
    expect(wrapper.findAll('button').some(button => button.text() === '取消任务')).toBe(false)
  })
})
