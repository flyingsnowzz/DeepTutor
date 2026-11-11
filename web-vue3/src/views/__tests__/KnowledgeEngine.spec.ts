import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KnowledgeBasesPage from '../KnowledgeBasesPage.vue'
import { api, authStatus } from '../../api'
import { useRoute, useRouter } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn(), authStatus: vi.fn(), post: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: vi.fn(), useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const route = { params: {}, query: { engine: 'graphrag' }, path: '/knowledge-bases' }
const replace = vi.fn()

describe('Knowledge engine settings', () => {
  beforeEach(() => {
    apiMock.mockReset(); replace.mockReset()
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
    vi.mocked(authStatus).mockResolvedValue({ enabled: false, authenticated: false, is_admin: true })
    apiMock.mockImplementation(async (path, init) => {
      if (path === '/api/knowledge-bases/rag-providers') return { providers: [{ id: 'graphrag', name: 'GraphRAG', description: 'Graph retrieval', configured: true, modes: ['local', 'global'], default_mode: 'local' }] }
      if (path === '/api/knowledge-bases/rag-pipelines/graphrag/config') return init?.method === 'PUT' ? JSON.parse(String(init.body)) : { retrieval_profile: 'hybrid', top_k: 5 }
      if (path === '/api/knowledge-bases/rag-pipelines/graphrag/preflight') return { checks: [{ key: 'ready', label: 'Ready', ok: true }] }
      if (path === '/api/knowledge-bases/list') return []
      return {}
    })
  })

  it('saves retrieval mode and engine configuration as an administrator', async () => {
    const wrapper = mount(KnowledgeBasesPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('select').setValue('global')
    await wrapper.get('input[type="number"]').setValue(8)
    await wrapper.findAll('button').find(button => button.text() === '保存引擎配置')?.trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/knowledge-bases/rag-providers/graphrag/mode', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ mode: 'global' }) }))
    expect(apiMock).toHaveBeenCalledWith('/api/knowledge-bases/rag-pipelines/graphrag/config', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ retrieval_profile: 'hybrid', top_k: 8 }) }))
  })
})
