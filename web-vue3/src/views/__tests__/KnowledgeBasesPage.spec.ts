import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KnowledgeBasesPage from '../KnowledgeBasesPage.vue'
import { api, post } from '../../api'
import { useRoute, useRouter } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: vi.fn(), useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const route = { params: { kbName: 'kb1' } }
const push = vi.fn()
const detail = { name: 'kb1', status: 'ready', is_default: false, read_only: false }

describe('KnowledgeBasesPage', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset(); push.mockReset()
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async path => {
      if (path === '/api/knowledge-bases/list') return [detail]
      if (path === '/api/knowledge-bases/kb1') return detail
      if (path === '/api/knowledge-bases/kb1/files') return { files: [{ name: 'guide.pdf', type: 'file' }] }
      if (path === '/api/knowledge-bases/kb1/progress') return { stage: 'completed', percent: 100 }
      if (path === '/api/knowledge-bases/default/kb1') return {}
      if (path === '/api/knowledge-bases/kb1/file-preview-text/guide.pdf') return { text: 'Preview text' }
      return {}
    })
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  it('sets a default, previews files and deletes the knowledge base by name', async () => {
    const wrapper = mount(KnowledgeBasesPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '设置')?.trigger('click')
    await wrapper.findAll('button').find(button => button.text()?.includes('设为默认'))?.trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/knowledge-bases/default/kb1', { method: 'PUT' })
    await wrapper.findAll('button').find(button => button.text() === '文件')?.trigger('click')
    await wrapper.get('button[aria-label="guide.pdf"]').trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/knowledge-bases/kb1/file-preview-text/guide.pdf')
    await wrapper.findAll('button').find(button => button.text() === '设置')?.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '删除知识库')?.trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/knowledge-bases/delete', { name: 'kb1' })
    expect(push).toHaveBeenCalledWith('/knowledge-bases')
  })

  it('creates a knowledge base and uses the server-assigned name', async () => {
    route.params.kbName = ''
    const wrapper = mount(KnowledgeBasesPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ name: 'server-kb', task_id: 't1', stage: 'running' }), { status: 200 }))
    await wrapper.findAll('button').find(button => button.text().includes('新建知识库'))?.trigger('click')
    await wrapper.get('input[aria-label="知识库名称"]').setValue('client-kb')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(push).toHaveBeenCalledWith('/knowledge-bases/server-kb')
  })
})
