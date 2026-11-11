import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SpacePage from '../SpacePage.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn() }))
const apiMock = vi.mocked(api)

function responseFor(path: string): any {
  if (path === '/api/capabilities/registered') return { capabilities: [] }
  if (path.startsWith('/api/sessions')) return { sessions: [{ id: 's1' }, { id: 's2' }] }
  if (path === '/api/notebooks') return { notebooks: [{ id: 'n1' }] }
  if (path.startsWith('/api/question-notebook')) return { total: 42, items: [] }
  if (path === '/api/knowledge-bases/list') return [{ name: 'kb' }]
  throw new Error(`Unexpected request: ${path}`)
}

describe('SpacePage', () => {
  beforeEach(() => { apiMock.mockReset() })

  it('renders independent live counts and omits unavailable optional projects', async () => {
    apiMock.mockImplementation(async path => responseFor(String(path)))
    const wrapper = mount(SpacePage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    await flushPromises()
    expect(wrapper.text()).toContain('2段对话')
    expect(wrapper.text()).toContain('1个收藏夹')
    expect(wrapper.text()).toContain('42道题')
    expect(wrapper.text()).toContain('1个知识库')
    expect(wrapper.text()).not.toContain('密语')
    expect(wrapper.text()).not.toContain('更多项目')
  })

  it('shows an installed optional project and keeps navigation when a count fails', async () => {
    apiMock.mockImplementation(async path => {
      if (path === '/api/capabilities/registered') return [{ id: 'whisper_visitor', available: true }]
      if (path === '/api/notebooks') throw new Error('Notebook count unavailable')
      return responseFor(String(path))
    })
    const wrapper = mount(SpacePage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    await flushPromises()
    expect(wrapper.text()).toContain('密语')
    expect(wrapper.text()).toContain('收藏夹')
    expect(wrapper.text()).toContain('2段对话')
  })

  it('loads account-level counts on the personalization surface', async () => {
    apiMock.mockImplementation(async path => {
      if (path === '/api/capabilities/registered') return []
      if (path === '/api/subagents/connections') return { connections: [{}] }
      if (path === '/api/personas') return { personas: [{}, {}] }
      if (path === '/api/skills/list') return { skills: [{}] }
      if (path === '/api/space/mcp/servers') return { servers: { one: {} } }
      if (path === '/api/space/cli-apps/apps') return { apps: [{ granted: true, enabled: true }, { granted: false, enabled: true }] }
      throw new Error(`Unexpected request: ${path}`)
    })
    const wrapper = mount(SpacePage, { props: { personal: true }, global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    await flushPromises()
    expect(wrapper.text()).toContain('1个智能体')
    expect(wrapper.text()).toContain('2个预设')
    expect(wrapper.text()).toContain('1个应用')
    expect(wrapper.text()).not.toContain('聊天历史')
  })
})
