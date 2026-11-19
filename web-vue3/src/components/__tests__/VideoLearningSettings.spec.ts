import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VideoLearningSettings from '../VideoLearningSettings.vue'
import { api, post } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const live = { version: 1, default_provider: 'youtube', youtube: { transcript_provider: 'youtube_transcript_api' }, invidious: { api_base_url: 'https://video.example', public_base_url: '' } }

describe('VideoLearningSettings', () => {
  beforeEach(() => { apiMock.mockReset(); postMock.mockReset() })

  it('hides editable defaults and offers retry after an invalid response', async () => {
    apiMock.mockResolvedValueOnce({ version: 1 }).mockResolvedValueOnce(live)
    const wrapper = mount(VideoLearningSettings, { props: { language: 'en' } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('unexpected video learning settings payload')
    expect(wrapper.find('.video-provider-grid').exists()).toBe(false)
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Native YouTube')
  })

  it('does not show an obsolete test result after the connection changes', async () => {
    apiMock.mockResolvedValue(live)
    let resolveTest!: (value: unknown) => void
    postMock.mockImplementation(() => new Promise(resolve => { resolveTest = resolve }) as never)
    const wrapper = mount(VideoLearningSettings, { props: { language: 'en' } })
    await flushPromises()
    await wrapper.get('.video-connection button').trigger('click')
    await wrapper.get('.video-connection input').setValue('https://new.example')
    resolveTest({ ok: true, message: 'old connection' })
    await flushPromises()
    expect(wrapper.text()).not.toContain('old connection')
    expect((wrapper.emitted('change')?.at(-1)?.[0] as typeof live).invidious.api_base_url).toBe('https://new.example')
  })
})
