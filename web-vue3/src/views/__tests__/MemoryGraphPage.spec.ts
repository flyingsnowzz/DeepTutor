import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MemoryGraphPage from '../MemoryGraphPage.vue'
import { fetchMemorySnapshot } from '../../memory/graph'
import { useRouter } from 'vue-router'

vi.mock('../../memory/graph', async importOriginal => {
  const actual = await importOriginal<typeof import('../../memory/graph')>()
  return { ...actual, fetchMemorySnapshot: vi.fn() }
})
vi.mock('vue-router', () => ({ useRouter: vi.fn() }))
const push = vi.fn()
const entry = 'm_00000000000000000000000000'

describe('MemoryGraphPage', () => {
  beforeEach(() => {
    push.mockReset()
    vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>)
    vi.mocked(fetchMemorySnapshot).mockResolvedValue({
      l1: { chat: [{ id: 'e1', label: 'Conversation', ts: '', content: 'Raw' }], notebook: [], quiz: [], kb: [], book: [], partner: [], cowriter: [] },
      l2: { chat: { title: 'Chat', entries: [{ id: entry, section: 'Facts', text: 'Summary', refs: ['chat:e1'] }] }, notebook: { title: '', entries: [] }, quiz: { title: '', entries: [] }, kb: { title: '', entries: [] }, book: { title: '', entries: [] }, partner: { title: '', entries: [] }, cowriter: { title: '', entries: [] } },
      l3: { profile: { title: 'Profile', entries: [{ id: entry, section: 'Preferences', text: 'Preference', refs: [`chat:${entry}`] }] }, recent: { title: '', entries: [] }, scope: { title: '', entries: [] } },
    })
  })

  it('filters layers, zooms and opens a focused memory entry', async () => {
    const wrapper = mount(MemoryGraphPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.findAll('.memory-node').length).toBe(3)
    await wrapper.get('.memory-graph-layer-controls button').trigger('click')
    expect(wrapper.findAll('.memory-node').length).toBe(2)
    await wrapper.get('button[aria-label="放大"]').trigger('click')
    expect(wrapper.get('svg').attributes('viewBox')).not.toBe('0 0 1200 1200')
    const node = wrapper.find(`[data-node="L2:chat:${entry}"]`)
    await node.trigger('click')
    await node.trigger('dblclick')
    expect(push).toHaveBeenCalledWith(`/memory/l2/chat?focus=${entry}`)
  })
})
