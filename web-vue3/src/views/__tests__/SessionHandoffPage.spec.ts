import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SessionHandoffPage from '../SessionHandoffPage.vue'
import { post } from '../../api'

vi.mock('../../api', () => ({ post: vi.fn() }))
const postMock = vi.mocked(post)
const writeText = vi.fn()

describe('SessionHandoffPage', () => {
  beforeEach(() => {
    postMock.mockReset()
    writeText.mockReset()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  })

  it('creates a one-time pairing link and copies it', async () => {
    postMock.mockResolvedValue({ code: 'ABCD-1234', handoff_url: 'https://public.example/handoff?code=ABCD-1234', expires_in: 300 })
    writeText.mockResolvedValue(undefined)
    const wrapper = mount(SessionHandoffPage, { global: { stubs: { RouterLink: true } } })
    await wrapper.get('input').setValue('https://public.example')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/auth/session-handoff', { public_origin: 'https://public.example' })
    expect(wrapper.text()).toContain('ABCD-1234')
    expect(wrapper.text()).toContain('300 秒后过期')
    await wrapper.get('.session-handoff-result button').trigger('click')
    expect(writeText).toHaveBeenCalledWith('https://public.example/handoff?code=ABCD-1234')
    expect(wrapper.text()).toContain('已复制')
  })

  it('clears stale results and exposes creation failures', async () => {
    postMock.mockRejectedValue(new Error('HTTPS origin required'))
    const wrapper = mount(SessionHandoffPage, { global: { stubs: { RouterLink: true } } })
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('HTTPS origin required')
    expect(wrapper.find('button').attributes('disabled')).toBeUndefined()
  })
})
