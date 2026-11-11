import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import VideoLessonViewer from '../components/VideoLessonViewer.vue'
import type { VideoLessonResult } from '../videoLesson'

function lesson(overrides: Partial<VideoLessonResult> = {}): VideoLessonResult {
  return {
    response: 'Summary',
    title: 'Calculus',
    page: { type: 'html', url: '/files/outputs/lesson.html', filename: 'lesson.html' },
    code: 'export const Lesson = () => null',
    durationSeconds: 90,
    attempts: 2,
    ...overrides,
  }
}

describe('VideoLessonViewer', () => {
  it('renders a sandboxed player, duration and repair count', () => {
    const wrapper = mount(VideoLessonViewer, { props: { result: lesson() } })
    const iframe = wrapper.get('iframe')
    expect(iframe.attributes('src')).toContain('/files/outputs/lesson.html')
    expect(iframe.attributes('title')).toBe('Calculus')
    expect(iframe.attributes('sandbox')).toBe('allow-scripts')
    expect(iframe.attributes('allowfullscreen')).toBeDefined()
    expect(wrapper.text()).toContain('90 秒')
    expect(wrapper.text()).toContain('经 2 次检查后修复')
  })

  it('shows the Remotion source and external-open link', () => {
    const wrapper = mount(VideoLessonViewer, { props: { result: lesson() } })
    expect(wrapper.get('a').attributes('target')).toBe('_blank')
    expect(wrapper.get('details summary').text()).toContain('查看 Remotion 代码')
    expect(wrapper.get('pre').text()).toContain('export const Lesson')
  })

  it('falls back to a localized title and hides optional metadata', () => {
    const wrapper = mount(VideoLessonViewer, {
      props: { result: lesson({ title: '', code: '', durationSeconds: null, attempts: 1 }) },
    })
    expect(wrapper.get('iframe').attributes('title')).toBe('视频讲解')
    expect(wrapper.find('.video-lesson-meta').exists()).toBe(false)
    expect(wrapper.find('.video-lesson-code').exists()).toBe(false)
  })

  it('keeps absolute lesson URLs unchanged', () => {
    const wrapper = mount(VideoLessonViewer, {
      props: { result: lesson({ page: { type: 'html', url: 'https://example.com/lesson.html' } }) },
    })
    expect(wrapper.get('iframe').attributes('src')).toBe('https://example.com/lesson.html')
  })
})
