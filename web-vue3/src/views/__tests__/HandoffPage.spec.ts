import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import HandoffPage from '../HandoffPage.vue'
import { post } from '../../api'
import { useRouter } from 'vue-router'

vi.mock('../../api', () => ({ post: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: vi.fn() }))
const postMock = vi.mocked(post)
const replace = vi.fn()

describe('HandoffPage', () => {
  beforeEach(() => {
    postMock.mockReset()
    replace.mockReset()
    window.history.replaceState({}, '', '/handoff')
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
  })

  it('removes a supplied code from the address bar and completes the exchange once', async () => {
    window.history.replaceState({}, '', '/handoff?code=secret-code&next=%2Flearning%3Ftab%3Dreading')
    postMock.mockResolvedValueOnce({ ticket: 'one-time-ticket' }).mockResolvedValueOnce({})
    mount(HandoffPage)
    await flushPromises()
    expect(window.location.search).toBe('')
    expect(postMock.mock.calls).toEqual([
      ['/api/auth/session-handoff/exchange', { code: 'secret-code' }],
      ['/api/auth/session-handoff/complete', { ticket: 'one-time-ticket' }],
    ])
    expect(replace).toHaveBeenCalledWith('/learning?tab=reading')
  })

  it('rejects an external return URL', async () => {
    window.history.replaceState({}, '', '/handoff?code=secret-code&next=https%3A%2F%2Fevil.example%2F')
    postMock.mockResolvedValueOnce({ ticket: 'ticket' }).mockResolvedValueOnce({})
    mount(HandoffPage)
    await flushPromises()
    expect(replace).toHaveBeenCalledWith('/chat')
  })

  it('allows a manual retry after an invalid pairing code', async () => {
    postMock.mockRejectedValueOnce(new Error('Invalid code')).mockResolvedValueOnce({ ticket: 'ticket' }).mockResolvedValueOnce({})
    const wrapper = mount(HandoffPage)
    await wrapper.get('input').setValue('wrong')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Invalid code')
    await wrapper.get('input').setValue('correct')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(postMock).toHaveBeenNthCalledWith(2, '/api/auth/session-handoff/exchange', { code: 'correct' })
    expect(replace).toHaveBeenCalledWith('/chat')
  })
})
