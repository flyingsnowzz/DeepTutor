import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VisualizeConfigPanel from '../components/VisualizeConfigPanel.vue'
import {
  importVisualizer,
  installBundledVisualizer,
  listVisualizers,
  setVisualizerEnabled,
} from '../visualizerCatalog'
import { DEFAULT_VISUALIZE_CONFIG } from '../visualizeConfig'

vi.mock('../visualizerCatalog', () => ({
  listVisualizers: vi.fn(),
  installBundledVisualizer: vi.fn(),
  setVisualizerEnabled: vi.fn(),
  uninstallVisualizer: vi.fn(),
  importVisualizer: vi.fn(),
}))

const item = {
  id: 'chartjs',
  version: '1',
  display_name: 'Chart.js',
  description: '',
  render_target: 'native' as const,
  native_renderer: 'chartjs',
  origin: 'core' as const,
  installed: true,
  enabled: true,
  uninstallable: false,
  agentic: false,
}

describe('VisualizeConfigPanel', () => {
  beforeEach(() => {
    vi.mocked(listVisualizers).mockResolvedValue([item])
    vi.mocked(installBundledVisualizer).mockResolvedValue(undefined)
    vi.mocked(setVisualizerEnabled).mockResolvedValue(undefined)
    vi.mocked(importVisualizer).mockResolvedValue(undefined)
  })

  it('uses the live catalog for render modes and emits changes', async () => {
    const wrapper = mount(VisualizeConfigPanel, { props: { modelValue: DEFAULT_VISUALIZE_CONFIG } })
    await flushPromises()
    const select = wrapper.get('.visualize-config-field select')
    expect(select.text()).toContain('Chart.js')
    await select.setValue('chartjs')
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toMatchObject({ render_mode: 'chartjs' })
  })

  it('shows Manim quality and style controls only for Manim modes', async () => {
    const wrapper = mount(VisualizeConfigPanel, {
      props: { modelValue: { ...DEFAULT_VISUALIZE_CONFIG, render_mode: 'manim_video' } },
    })
    await flushPromises()
    expect(wrapper.find('.visualize-config-quality').exists()).toBe(true)
    await wrapper.get('.visualize-config-style input').setValue('warm')
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toMatchObject({ style_hint: 'warm' })
  })

  it('installs bundled renderers and refreshes the catalog', async () => {
    vi.mocked(listVisualizers).mockResolvedValue([
      { ...item, id: 'mermaid', origin: 'bundled', installed: false, enabled: false },
    ])
    const wrapper = mount(VisualizeConfigPanel, { props: { modelValue: DEFAULT_VISUALIZE_CONFIG } })
    await flushPromises()
    const install = wrapper.findAll('.visualize-config-types button').find(button => button.text().includes('+'))
    expect(install).toBeDefined()
    await install!.trigger('click')
    await flushPromises()
    expect(installBundledVisualizer).toHaveBeenCalledWith('mermaid')
  })
})
