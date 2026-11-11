import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PartnersPage from '../PartnersPage.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn() }))
const apiMock = vi.mocked(api)
const partner = {
  partner_id: 'p1', name: 'Researcher', description: 'Finds sources', emoji: '🔎', color: '#123456',
  running: true, channels: ['telegram', 'send_progress', 'send_tool_hints'],
}
const group = {
  group_id: 'g1', name: 'Study group', description: 'Learn together', emoji: '👥', color: '#123456',
  member_ids: ['p1', 'p2'], members: [partner, { ...partner, partner_id: 'p2', name: 'Writer' }],
  discussion_mode: 'panel_parallel', updated_at: '2026-11-09T08:00:00Z',
}

describe('PartnersPage', () => {
  beforeEach(() => { apiMock.mockReset() })

  it('renders partner status, useful channels and group membership', async () => {
    apiMock.mockImplementation(async path => path === '/api/partners' ? [partner, { ...partner, partner_id: 'p2', can_manage: false }] : [group])
    const wrapper = mount(PartnersPage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    await flushPromises()
    expect(wrapper.text()).toContain('Researcher')
    expect(wrapper.text()).toContain('运行中')
    expect(wrapper.text()).toContain('telegram')
    expect(wrapper.text()).not.toContain('send_progress')
    expect(wrapper.text()).toContain('共享给你')
    expect(wrapper.text()).toContain('2 位伙伴 · 并行回答')
    expect(wrapper.text()).toContain('新建群组')
  })

  it('offers a first-partner action and hides groups for an empty roster', async () => {
    apiMock.mockResolvedValue([])
    const wrapper = mount(PartnersPage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    await flushPromises()
    expect(wrapper.text()).toContain('创建第一个伙伴')
    expect(wrapper.text()).not.toContain('伙伴分组')
  })

  it('keeps a successfully loaded roster when the group request fails', async () => {
    apiMock.mockImplementation(async path => {
      if (path === '/api/partners') return [partner]
      throw new Error('Groups unavailable')
    })
    const wrapper = mount(PartnersPage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Groups unavailable')
    expect(wrapper.text()).toContain('Researcher')
    expect(wrapper.text()).toContain('再创建一位伙伴')
  })
})
