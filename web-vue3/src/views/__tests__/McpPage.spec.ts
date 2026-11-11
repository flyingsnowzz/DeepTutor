import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import McpPage from '../McpPage.vue'
import { api, post } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const state = {
  servers: { old: { type: 'sse', url: 'https://old.example/mcp', headers: { Authorization: '${secret:old/token}', 'X-Old': 'remove' }, enabled: true, allow_private_network: true } },
  status: {}, configured_secrets: { old: ['token'] }, oauth: {}, rejected: [], deployment: { servers: [] }, limits: { max_servers: 5 },
}

describe('McpPage', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset()
    apiMock.mockImplementation(async (path, init) => {
      if (path === '/api/space/mcp/servers') return state
      if (String(path).startsWith('/api/space/mcp/catalog?')) return { entries: [], categories: {}, next_cursor: '', total: 0 }
      if (init?.method === 'PUT') return state
      return state
    })
  })

  it('retains stored secrets, removes deleted plain headers and preserves private-origin approval', async () => {
    const wrapper = mount(McpPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '编辑')?.trigger('click')
    await wrapper.get('textarea[placeholder="Authorization: Bearer ..."]').setValue('X-New: value')
    await wrapper.get('.mcp-editor form').trigger('submit.prevent')
    await flushPromises()
    const put = apiMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    const body = JSON.parse(String(put?.[1]?.body))
    expect(body.config.headers).toEqual({ Authorization: '${secret:old/token}', 'X-New': 'value' })
    expect(body.config.allow_private_network).toBe(true)
    expect(body.config.type).toBe('sse')
  })

  it('rejects duplicate server names before writing', async () => {
    const wrapper = mount(McpPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '添加远程服务')?.trigger('click')
    await wrapper.get('.mcp-editor input[pattern]').setValue('old')
    await wrapper.get('input[placeholder="https://example.com/mcp"]').setValue('https://new.example/mcp')
    await wrapper.get('.mcp-editor form').trigger('submit.prevent')
    expect(wrapper.get('[role="alert"]').text()).toContain('同名服务已存在')
    expect(apiMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('shows detected tools after a connection test', async () => {
    postMock.mockResolvedValue({ ok: true, tools: [{ name: 'search', description: 'Search documents' }] })
    const wrapper = mount(McpPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '编辑')?.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '测试连接')?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('连接成功，发现 1 个工具')
    expect(wrapper.text()).toContain('Search documents')
  })

  it('requires catalog credentials before install and tests after installation', async () => {
    const entry = { id: 'github', display_name: 'GitHub', description_i18n: { zh: '代码' }, category: 'dev', tier: 'curated', transport: 'streamableHttp', self_service: true, installed: false, installed_as: [], fields: [{ key: 'token', label_i18n: { zh: '令牌' }, secret: true, required: true, placeholder: '' }] }
    apiMock.mockImplementation(async path => {
      if (path === '/api/space/mcp/servers') return { ...state, servers: {} }
      if (String(path).startsWith('/api/space/mcp/catalog?')) return { entries: [entry], categories: { dev: 1 }, next_cursor: '', total: 1 }
      return { ...state, servers: { github: { url: 'https://github.example/mcp' } } }
    })
    postMock.mockResolvedValueOnce({ ...state, servers: { github: { url: 'https://github.example/mcp' } } }).mockResolvedValueOnce({ ok: true, tools: [{}] })
    const wrapper = mount(McpPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '商店')?.trigger('click')
    await flushPromises()
    await wrapper.get('[role="button"][aria-label="查看详情：GitHub"]').trigger('click')
    const install = wrapper.get('.mcp-install-actions .primary')
    expect(install?.attributes('disabled')).toBeDefined()
    await wrapper.get('input[type="password"]').setValue('secret')
    await flushPromises()
    expect(install?.attributes('disabled')).toBeUndefined()
    await wrapper.get('.mcp-install-panel form').trigger('submit.prevent')
    await flushPromises()
    expect(postMock).toHaveBeenNthCalledWith(1, '/api/space/mcp/catalog/github/install', { name: 'github', secrets: { token: 'secret' } })
    expect(postMock).toHaveBeenNthCalledWith(2, '/api/space/mcp/servers/github/test', expect.any(Object))
    expect(wrapper.text()).toContain('检测到 1 个工具')
  })
})
