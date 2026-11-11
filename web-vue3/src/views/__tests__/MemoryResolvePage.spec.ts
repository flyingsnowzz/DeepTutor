import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MemoryResolvePage from '../MemoryResolvePage.vue'
import { api, ApiError } from '../../api'
import { useRoute, useRouter } from 'vue-router'

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, api: vi.fn() }
})
vi.mock('vue-router', () => ({ useRoute: vi.fn(), useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const route = { query: {} as Record<string, string> }
const replace = vi.fn()

describe('MemoryResolvePage', () => {
  beforeEach(() => {
    apiMock.mockReset()
    replace.mockReset()
    route.query = {}
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
  })

  it('explains a missing citation id without making a request', async () => {
    const wrapper = mount(MemoryResolvePage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('缺少 id')
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('resolves a citation to its owner document and focused entry', async () => {
    route.query.id = 'm_01ABC'
    apiMock.mockResolvedValue({ layer: 'L2', key: 'surface/a', entry_id: 'm_01ABC' })
    mount(MemoryResolvePage)
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/memory/resolve_entry/m_01ABC', expect.any(Object))
    expect(replace).toHaveBeenCalledWith({ path: '/memory/l2/surface%2Fa', query: { focus: 'm_01ABC' } })
  })

  it('distinguishes deleted entries from other resolver failures', async () => {
    route.query.id = 'missing'
    apiMock.mockRejectedValue(new ApiError(404, 'Not found'))
    const wrapper = mount(MemoryResolvePage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('可能已被删除')
  })
})
