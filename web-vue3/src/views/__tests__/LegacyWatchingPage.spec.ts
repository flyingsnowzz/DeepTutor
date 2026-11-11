import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LegacyWatchingPage from '../LegacyWatchingPage.vue'
import { api } from '../../api'
import { useRoute, useRouter } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: vi.fn(), useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const route = { params: { sessionId: 'legacy-1' } as { sessionId?: string | string[] } }
const replace = vi.fn()

describe('LegacyWatchingPage', () => {
  beforeEach(() => {
    apiMock.mockReset()
    replace.mockReset()
    route.params.sessionId = 'legacy-1'
    vi.mocked(useRoute).mockReturnValue(route as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
  })

  it('migrates once and returns to the reading session that owns the conversation', async () => {
    apiMock.mockResolvedValue({ id: 'legacy-1', preferences: { workspace_mode: 'immersive_reading', reading_workspace_id: 'reading-1' } })
    mount(LegacyWatchingPage)
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/sessions/legacy-1/migrate-watching', expect.objectContaining({ method: 'POST' }))
    expect(replace).toHaveBeenCalledWith('/learning/reading/reading-1/sessions/legacy-1?dt_workspace=')
  })

  it('offers retry after a migration failure', async () => {
    apiMock.mockRejectedValueOnce(new Error('Migration failed')).mockResolvedValueOnce({ id: 'legacy-1' })
    const wrapper = mount(LegacyWatchingPage)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Migration failed')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(replace).toHaveBeenCalledWith('/chat/legacy-1?dt_workspace=')
  })
})
