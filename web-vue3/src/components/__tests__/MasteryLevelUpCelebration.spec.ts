import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import MasteryLevelUpCelebration from '../MasteryLevelUpCelebration.vue'

describe('MasteryLevelUpCelebration', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('fires three paper cannons and clears itself after the animation', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrame = 1
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, callback); return id }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)))
    const context = { setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), globalAlpha: 1, fillStyle: '' }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    const wrapper = mount(MasteryLevelUpCelebration)
    const start = performance.now()
    const run = (offset: number) => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(start + offset)) }
    run(16); run(130); run(300)
    expect(context.fillRect.mock.calls.length).toBeGreaterThan(0)
    expect(context.beginPath.mock.calls.length).toBeGreaterThan(0)
    expect(wrapper.emitted('done')).toBeUndefined()
    run(3400)
    expect(wrapper.emitted('done')).toHaveLength(1)
    wrapper.unmount()
  })

  it('honors reduced motion without rendering a canvas', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const wrapper = mount(MasteryLevelUpCelebration)
    await nextTick()
    expect(wrapper.emitted('done')).toHaveLength(1)
    expect(document.body.querySelector('canvas')).toBeNull()
    wrapper.unmount()
  })
})
