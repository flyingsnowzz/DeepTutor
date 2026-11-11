import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PartnerDetailPage from '../PartnerDetailPage.vue'
import { api, post } from '../../api'
import { useRoute, useRouter } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: vi.fn(), useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const route = { params: { groupId: 'g1', partnerId: 'p1' } }
const replace = vi.fn()
const group = { group_id: 'g1', name: 'Group', description: '', member_ids: ['p1', 'p2'], members: [], discussion_mode: 'panel_parallel' }

describe('PartnerDetailPage', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset(); replace.mockReset()
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async path => {
      if (path === '/api/partner-groups/g1') return group
      if (path === '/api/partners') return [{ partner_id: 'p1', name: 'One' }, { partner_id: 'p2', name: 'Two' }]
      if (path === '/api/partner-groups/discussion-modes') return [{ name: 'panel_parallel', label: '', description: '' }, { name: 'debate', label: '', description: '' }]
      if (String(path).includes('/sessions')) return []
      if (String(path).includes('/history')) return []
      return group
    })
  })

  it('edits group members and discussion mode', async () => {
    const wrapper = mount(PartnerDetailPage, { props: { kind: 'group' }, global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '管理')?.trigger('click')
    await wrapper.get('select[aria-label="讨论方式"]').setValue('debate')
    await wrapper.get('form.partner-edit').trigger('submit.prevent')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/partner-groups/g1', expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"discussion_mode":"debate"') }))
    expect(apiMock).toHaveBeenCalledWith('/api/partner-groups/g1', expect.objectContaining({ body: expect.stringContaining('"member_ids":["p1","p2"]') }))
  })

  it('streams a direct partner reply', async () => {
    apiMock.mockImplementation(async path => {
      if (path === '/api/partners/p1') return { partner_id: 'p1', name: 'Partner', can_manage: true, running: true }
      if (String(path).includes('/sessions')) return [{ session_key: 'default', title: 'Default' }]
      if (String(path).includes('/history')) return [{ role: 'assistant', content: '**Answer**' }]
      return []
    })
    globalThis.fetch = vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('event: content\ndata: {"content":"**Answer**"}\n\nevent: done\ndata: {}\n\n')); controller.close() } }), { status: 200 }))
    const wrapper = mount(PartnerDetailPage, { props: { kind: 'partner' }, global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('textarea').setValue('Question')
    await wrapper.get('form.partner-composer').trigger('submit.prevent')
    await flushPromises()
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/partners/p1/chat/execute-stream'), expect.any(Object))
    expect(wrapper.find('.partner-direct-messages strong').text()).toBe('Answer')
  })
})
