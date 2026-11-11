import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MediaReadingStage from '../MediaReadingStage.vue'
import {
  createVideoMark,
  getVideoMaterial,
  listVideoMarks,
  saveVideoProgress,
} from '../../videoLearning'

vi.mock('../../videoLearning', async importOriginal => {
  const actual = await importOriginal<typeof import('../../videoLearning')>()
  return {
    ...actual,
    getVideoMaterial: vi.fn(),
    listVideoMarks: vi.fn(),
    createVideoMark: vi.fn(),
    deleteVideoMark: vi.fn(),
    updateVideoMark: vi.fn(),
    suggestVideoMarks: vi.fn(),
    saveVideoProgress: vi.fn(),
  }
})

const material = {
  version: 1,
  type: 'timed_media' as const,
  material_id: 'v1',
  source: { provider: 'invidious' as const, video_id: 'vid', url: 'https://example.com', entry_time_seconds: 0 },
  metadata: { title: 'Calculus', author: 'Tutor', duration_seconds: 20 },
  transcript: { status: 'ready' as const, reason: '', language: 'en', source: 'test', cues: [] },
  segments: [
    { start: 0, end: 10, text: 'First idea', locator: 1 },
    { start: 10, end: 20, text: 'Second idea', locator: 2 },
  ],
  learning: { last_position: 2, marks: [] },
  playback: {
    provider: 'invidious' as const,
    kind: 'html5' as const,
    format_id: 'mp4',
    mime_type: 'video/mp4',
    stream_url: '/stream.mp4',
    subtitles_url: '/subs.vtt',
    start_seconds: 0,
  },
}

describe('MediaReadingStage', () => {
  beforeEach(() => {
    vi.mocked(getVideoMaterial).mockResolvedValue(material)
    vi.mocked(listVideoMarks).mockResolvedValue([])
    vi.mocked(saveVideoProgress).mockResolvedValue(undefined)
    vi.mocked(createVideoMark).mockResolvedValue({
      mark_id: 'm1',
      kind: 'key_point',
      start_seconds: 0,
      end_seconds: 10,
      start_locator: 1,
      end_locator: 1,
      quote: 'First idea',
      note: '',
      author: 'user',
      created_at: '',
      updated_at: '',
    })
  })

  it('renders the transcript, native player and current segment', async () => {
    const wrapper = mount(MediaReadingStage, { props: { materialId: 'v1' } })
    await flushPromises()
    expect(wrapper.get('video').attributes('src')).toBe('/stream.mp4')
    expect(wrapper.text()).toContain('First idea')
    expect(wrapper.findAll('.media-transcript li')[0]!.classes()).toContain('active')
    await wrapper.findAll('.media-transcript button')[1]!.trigger('click')
    expect(wrapper.emitted('locatorChange')?.at(-1)).toEqual([2])
  })

  it('creates a mark for the current transcript segment', async () => {
    const wrapper = mount(MediaReadingStage, { props: { materialId: 'v1' } })
    await flushPromises()
    await wrapper.get('.media-mark-create button').trigger('click')
    expect(createVideoMark).toHaveBeenCalledWith('v1', expect.objectContaining({
      kind: 'key_point',
      start_seconds: 0,
      end_seconds: 10,
      quote: 'First idea',
    }))
  })
})
