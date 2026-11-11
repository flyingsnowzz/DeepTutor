import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WatchingBrowser from '../components/WatchingBrowser.vue'
import { browseInvidious, invidiousAccount } from '../videoLearning'

vi.mock('../videoLearning', () => ({
  invidiousAccount: vi.fn(),
  browseInvidious: vi.fn(),
}))

describe('WatchingBrowser', () => {
  beforeEach(() => {
    vi.mocked(invidiousAccount).mockResolvedValue({ connected: true })
    vi.mocked(browseInvidious).mockResolvedValue([
      { videoId: 'v1', title: 'Lesson', author: 'Tutor', lengthSeconds: 75 },
    ])
  })

  it('loads the account feed and emits a selected YouTube URL', async () => {
    const wrapper = mount(WatchingBrowser)
    await flushPromises()
    expect(invidiousAccount).toHaveBeenCalledWith('status')
    await wrapper.get('.watching-card').trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual(['https://www.youtube.com/watch?v=v1'])
  })

  it('searches videos and keeps pasted links as direct selections', async () => {
    const wrapper = mount(WatchingBrowser)
    await flushPromises()
    await wrapper.get('.watching-search input').setValue('https://www.youtube.com/watch?v=external')
    await wrapper.get('.watching-search').trigger('submit')
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['https://www.youtube.com/watch?v=external'])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
