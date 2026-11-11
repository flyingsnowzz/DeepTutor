import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsTourOverlay from '../SettingsTourOverlay.vue'
import { useRoute, useRouter } from 'vue-router'

vi.mock('vue-router', () => ({ useRoute: vi.fn(), useRouter: vi.fn() }))
const push = vi.fn()
const route = { path: '/settings/status' }

describe('SettingsTourOverlay', () => {
  beforeEach(() => {
    push.mockReset()
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    document.querySelector('[data-tour="tour-status"]')?.remove()
    vi.unstubAllGlobals()
  })

  it('spotlights the target and emits navigation actions', async () => {
    const target = document.createElement('div')
    target.dataset.tour = 'tour-status'
    target.scrollIntoView = vi.fn()
    target.getBoundingClientRect = () => ({
      x: 30,
      y: 40,
      left: 30,
      top: 40,
      width: 300,
      height: 100,
      right: 330,
      bottom: 140,
      toJSON: () => ({}),
    })
    document.body.appendChild(target)

    const wrapper = mount(SettingsTourOverlay, {
      props: { stepIndex: 0 },
      global: { stubs: { LegacyIcon: true } },
    })
    await vi.waitFor(() => expect(wrapper.find('.settings-tour-tooltip').exists()).toBe(true))
    expect(wrapper.text()).toContain('状态')
    expect(target.scrollIntoView).toHaveBeenCalled()
    await wrapper.findAll('.settings-tour-tooltip footer button')[2]?.trigger('click')
    expect(wrapper.emitted('update:stepIndex')?.[0]).toEqual([1])
    await wrapper.get('button[aria-label="跳过设置引导"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
