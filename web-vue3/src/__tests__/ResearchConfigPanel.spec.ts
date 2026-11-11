import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ResearchConfigPanel from '../components/ResearchConfigPanel.vue'
import { createEmptyResearchConfig } from '../research'

describe('ResearchConfigPanel', () => {
  it('renders mode and depth selectors and reports validation errors', () => {
    const wrapper = mount(ResearchConfigPanel, { props: { modelValue: createEmptyResearchConfig() } })
    expect(wrapper.findAll('select')).toHaveLength(2)
    expect(wrapper.text()).toContain('必选')
  })
  it('emits mode updates', async () => {
    const wrapper = mount(ResearchConfigPanel, { props: { modelValue: createEmptyResearchConfig() } })
    await wrapper.findAll('select')[0].setValue('report')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([
      { mode: 'report', depth: '' },
    ])
  })
  it('shows manual controls only for manual depth and emits counts', async () => {
    const wrapper = mount(ResearchConfigPanel, {
      props: { modelValue: { mode: 'notes', depth: 'manual', manual_max_iterations: 3 } },
    })
    expect(wrapper.find('.research-config-manual').exists()).toBe(true)
    const inputs = wrapper.findAll('input[type="number"]')
    expect(inputs).toHaveLength(2)
    await inputs[0].setValue('4')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([
      { mode: 'notes', depth: 'manual', manual_max_iterations: 3, manual_subtopics: 4 },
    ])
    const wrapper2 = mount(ResearchConfigPanel, { props: { modelValue: { mode: 'notes', depth: 'quick' } } })
    expect(wrapper2.find('.research-config-manual').exists()).toBe(false)
  })
})
