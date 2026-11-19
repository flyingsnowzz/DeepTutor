import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MemorySettings from '../MemorySettings.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn() }))
const apiMock = vi.mocked(api)
const live = {
  update: { l2_budget: 6, l3_budget: 7 }, audit: { l2_budget: 3, l3_budget: 4 },
  dedup: { iterations: 3, auto_after_update: false },
  merge: { auto_after_update: false, auto_after_audit: true, auto_after_dedup: false },
  chunking: { overlap_ratio: 0.1, boundary: 'paragraph', min_chunk_chars: 1200, max_chunk_chars: 4000 },
  reference: { enforce_required: true, drop_invalid_refs: true },
}

describe('MemorySettings', () => {
  beforeEach(() => { apiMock.mockReset() })

  it('shows an error without editable defaults when loading fails', async () => {
    apiMock.mockRejectedValue(new Error('HTTP 503'))
    const wrapper = mount(MemorySettings, { props: { language: 'en' } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Failed to load settings')
    expect(wrapper.find('input[type="number"]').exists()).toBe(false)
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('renders English fields and stages edits against loaded values', async () => {
    apiMock.mockResolvedValue(live)
    const wrapper = mount(MemorySettings, { props: { language: 'en' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Chunking')
    expect(wrapper.get('input[aria-label="L2 budget (per surface)"]').element.getAttribute('value')).toBe('6')
    await wrapper.get('input[aria-label="Iterations"]').setValue('5')
    expect((wrapper.emitted('change')?.at(-1)?.[0] as typeof live).dedup.iterations).toBe(5)
  })

  it('ignores a stale response after a revision reload', async () => {
    let resolveOld!: (value: unknown) => void
    apiMock.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }) as never)
      .mockResolvedValueOnce({ ...live, update: { l2_budget: 12, l3_budget: 13 } })
    const wrapper = mount(MemorySettings, { props: { revision: 0 } })
    await wrapper.setProps({ revision: 1 })
    await flushPromises()
    resolveOld(live)
    await flushPromises()
    expect(wrapper.get('input[aria-label="L2 预算（每个 surface）"]').element.getAttribute('value')).toBe('12')
  })
})
