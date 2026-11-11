import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CliAppsPage from '../CliAppsPage.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn() }))
const apiMock = vi.mocked(api)
const app = { id: 'reader', display_name: 'Reader', description: 'Read files', tool_name: 'reader', category: 'files', trust: 'verified', granted: true, enabled: true, in_catalog: true }
const state = { apps: [app], access: { exec_denied: false } }
const entry = { id: 'writer', display_name: 'Writer', description: 'Write files', category: 'files', trust: 'community', installed: false, installable: true }

describe('CliAppsPage', () => {
  beforeEach(() => {
    apiMock.mockReset()
    apiMock.mockImplementation(async (path, init) => {
      if (path === '/api/space/cli-apps/apps') return state
      if (path === '/api/auth/status') return { is_admin: true }
      if (String(path).startsWith('/api/space/cli-apps/catalog?')) return { entries: [entry], categories: { files: 1 }, next_cursor: '', total: 1 }
      if (String(path).includes('/enabled')) return { ...state, apps: [{ ...app, enabled: false }] }
      if (String(path).includes('/install')) return { ...state, apps: [app, { ...app, id: 'writer', display_name: 'Writer' }] }
      return state
    })
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  it('toggles account-level enablement without requiring admin installation', async () => {
    const wrapper = mount(CliAppsPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('1 个可用')
    await wrapper.get('button[role="switch"]').trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/space/cli-apps/apps/reader/enabled', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ enabled: false }) }))
    expect(wrapper.text()).toContain('0 个可用')
  })

  it('lets an administrator install catalog entries and blocks unsupported entries', async () => {
    const wrapper = mount(CliAppsPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '商店')?.trigger('click')
    await flushPromises()
    await wrapper.get('.cli-catalog-grid li').trigger('click')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...state, apps: [app, { ...app, id: 'writer', display_name: 'Writer' }], log: 'installed' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await wrapper.findAll('button').find(button => button.text() === '安装')?.trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/space/cli-apps/catalog/writer/install'), expect.objectContaining({ method: 'POST', credentials: 'include' }))
    expect(wrapper.text()).toContain('安装完成')
  })

  it('keeps the store read-only for non-administrators', async () => {
    apiMock.mockImplementation(async path => {
      if (path === '/api/space/cli-apps/apps') return state
      if (path === '/api/auth/status') return { is_admin: false }
      return { entries: [entry], categories: { files: 1 }, next_cursor: '', total: 1 }
    })
    const wrapper = mount(CliAppsPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '商店')?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('管理员操作')
    expect(wrapper.findAll('button').some(button => button.text() === '安装')).toBe(false)
    expect(wrapper.findAll('button').some(button => button.text() === '卸载')).toBe(false)
  })
})
