import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MathAnimatorViewer from '../components/MathAnimatorViewer.vue'
import type { MathAnimatorResult } from '../mathAnimator'

function result(overrides: Partial<MathAnimatorResult> = {}): MathAnimatorResult {
  return {
    response: 'Done',
    output_mode: 'video',
    code: { language: 'python', content: 'class Scene(Scene): pass' },
    artifacts: [
      { type: 'video', url: '/files/scene.mp4', filename: 'scene.mp4' },
      { type: 'image', url: '/files/frame.png', filename: 'frame.png', label: 'Frame' },
    ],
    timings: { render: 2.5 },
    render: { quality: 'high', retry_attempts: 1, visual_review: { passed: false, summary: 'clipped', issues: ['edge cut'] } },
    ...overrides,
  }
}

describe('MathAnimatorViewer', () => {
  it('renders video and image artifacts with workspace-scoped URLs', () => {
    const wrapper = mount(MathAnimatorViewer, { props: { result: result() } })
    expect(wrapper.get('video').attributes('src')).toContain('/files/scene.mp4')
    expect(wrapper.get('img').attributes('alt')).toBe('Frame')
    expect(wrapper.text()).toContain('视频输出')
    expect(wrapper.text()).toContain('图片输出')
    expect(wrapper.text()).toContain('render 2.5s')
  })

  it('shows Manim source and failed visual review', () => {
    const wrapper = mount(MathAnimatorViewer, { props: { result: result() } })
    expect(wrapper.get('pre').text()).toContain('class Scene')
    expect(wrapper.find('.math-animator-warning').text()).toContain('edge cut')
  })

  it('opens and closes an image fullscreen overlay', async () => {
    const wrapper = mount(MathAnimatorViewer, { props: { result: result() } })
    await wrapper.get('.math-animator-image').trigger('click')
    expect(wrapper.find('.math-animator-fullscreen').exists()).toBe(true)
    await wrapper.get('.math-animator-fullscreen button').trigger('click')
    expect(wrapper.find('.math-animator-fullscreen').exists()).toBe(false)
  })

  it('hides optional code, review and metadata when absent', () => {
    const minimal = result({
      code: { language: 'python', content: '' },
      artifacts: [{ type: 'video', url: '/files/scene.mp4', filename: 'scene.mp4' }],
      timings: {},
      render: {},
    })
    const wrapper = mount(MathAnimatorViewer, { props: { result: minimal } })
    expect(wrapper.find('.math-animator-code').exists()).toBe(false)
    expect(wrapper.find('.math-animator-warning').exists()).toBe(false)
    expect(wrapper.find('.math-animator-meta').exists()).toBe(false)
  })
})
