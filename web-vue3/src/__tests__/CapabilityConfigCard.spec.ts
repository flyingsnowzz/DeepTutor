import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CapabilityConfigCard from '../components/CapabilityConfigCard.vue'

describe('CapabilityConfigCard', () => {
  it('renders required state, slot content and validation errors', () => {
    const wrapper = mount(CapabilityConfigCard, {
      props: { title: '研究设置', validationErrors: ['必选'] },
      slots: { default: '<form data-test="panel" />' },
    })
    expect(wrapper.text()).toContain('研究设置')
    expect(wrapper.text()).toContain('必填')
    expect(wrapper.text()).toContain('必选')
    expect(wrapper.find('[data-test="panel"]').exists()).toBe(true)
    expect(wrapper.find('button').attributes('disabled')).toBeUndefined()
  })

  it('emits confirm only when allowed', async () => {
    const wrapper = mount(CapabilityConfigCard, { props: { title: '研究设置' } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('shows confirmed state and disables the button', () => {
    const wrapper = mount(CapabilityConfigCard, { props: { title: '研究设置', confirmed: true } })
    expect(wrapper.text()).toContain('已确认')
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
  })

  it('disables confirmation for invalid configuration', () => {
    const wrapper = mount(CapabilityConfigCard, { props: { title: '研究设置', canConfirm: false } })
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
  })
})
