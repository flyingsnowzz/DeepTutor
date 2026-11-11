import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CoWriterHomePage from '../CoWriterHomePage.vue'
import { api } from '../../api'
import { useRouter } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const push = vi.fn()
const page = { id: 'p1', title: 'Biology', preview: 'Cells', updated_at: 10, parent_id: null, pinned: true, revision: 2, icon: '🧬' }

describe('CoWriterHomePage', () => {
  beforeEach(() => {
    apiMock.mockReset(); push.mockReset()
    vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async (path, init) => {
      if (path === '/api/documents' && !init) return { documents: [page, { ...page, id: 'p2', title: 'Child', parent_id: 'p1', pinned: false }] }
      if (path === '/api/documents' && init?.method === 'POST') return { ...page, id: 'new-page' }
      return {}
    })
  })

  it('shows top-level pages and searches children, then creates a page', async () => {
    const wrapper = mount(CoWriterHomePage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' }, NoteReview: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('Biology')
    expect(wrapper.text()).not.toContain('Child')
    await wrapper.get('input[type="search"]').setValue('Child')
    expect(wrapper.text()).toContain('Child')
    await wrapper.findAll('button').find(button => button.text() === '新建页面')?.trigger('click')
    await flushPromises()
    expect(push).toHaveBeenCalledWith('/co-writer/new-page')
  })

  it('pins with optimistic revision protection', async () => {
    const wrapper = mount(CoWriterHomePage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' }, NoteReview: true } } })
    await flushPromises()
    await wrapper.get('button[aria-label="页面操作：Biology"]').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '取消置顶')?.trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/documents/p1', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ pinned: false, expected_revision: 2 }) }))
  })
})
