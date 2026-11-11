import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NotebooksPage from '../NotebooksPage.vue'
import { api, post } from '../../api'
import { useRoute, useRouter } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: vi.fn(), useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const route = { params: { notebookId: 'n1' }, query: {} as Record<string, string> }
const push = vi.fn()
const replace = vi.fn()
const record = { id: 'r1', type: 'research', title: 'Saved research', summary: 'Summary', user_query: 'Question', output: '# Answer' }
const detail = { id: 'n1', name: 'Research', description: 'Sources', color: '#123456', records: [record] }

describe('NotebooksPage', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset(); push.mockReset(); replace.mockReset()
    route.params.notebookId = 'n1'; route.query = {}
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ push, replace } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async path => {
      if (path === '/api/notebooks') return { notebooks: [detail, { id: 'n2', name: 'Other', records: [] }] }
      if (path === '/api/notebooks/n1') return detail
      return {}
    })
  })

  it('edits a saved record and copies it to another notebook', async () => {
    const wrapper = mount(NotebooksPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('.library-card').get('button[aria-label="编辑收藏详情"]').trigger('click')
    await wrapper.get('input[aria-label="收藏标题"]').setValue('Updated research')
    await wrapper.get('.notebook-record-editor-actions .primary').trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/notebooks/n1/records/r1', expect.objectContaining({ method: 'PUT', body: expect.stringContaining('Updated research') }))
    await wrapper.get('button[aria-label="收藏操作"]').trigger('click')
    await wrapper.get('.notebook-record-menu').findAll('button').find(button => button.text().includes('复制到'))?.trigger('click')
    await wrapper.get('.notebook-record-targets button').trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/notebooks/n1/records/r1/actions/copy', { target_notebook_id: 'n2' })
  })

  it('creates a notebook and opens it', async () => {
    route.params.notebookId = ''
    postMock.mockResolvedValue({ notebook: { id: 'n2', name: 'New notebook' } })
    const wrapper = mount(NotebooksPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('input[aria-label="新收藏夹名称"]').setValue('New notebook')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/notebooks', { name: 'New notebook', description: '' })
    expect(push).toHaveBeenCalledWith('/notebooks/n2')
  })

  it('follows a moved favorite to its current collection', async () => {
    route.query.record = 'moved'
    apiMock.mockImplementation(async path => {
      if (path === '/api/notebooks') return { notebooks: [detail] }
      if (path === '/api/notebooks/n1') return detail
      if (String(path).startsWith('/api/notebooks/records/moved/location')) return { notebook_id: 'n2', record_id: 'moved' }
      return {}
    })
    mount(NotebooksPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(replace).toHaveBeenCalledWith({ path: '/notebooks/n2', query: { record: 'moved' } })
  })

  it('does not request an unreadable collection detail', async () => {
    apiMock.mockResolvedValue({ notebooks: [{ id: 'n1', name: 'Broken', unreadable: true }] })
    const wrapper = mount(NotebooksPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('原始数据已保留')
    expect(apiMock).toHaveBeenCalledTimes(1)
  })
})
