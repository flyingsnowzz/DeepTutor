import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ResearchOutlineEditor from '../components/ResearchOutlineEditor.vue'

const outline = [
  { title: 'A', overview: 'aa' },
  { title: 'B', overview: 'bb' },
]

describe('ResearchOutlineEditor', () => {
  it('edits titles and overviews and confirms the outline', async () => {
    const wrapper = mount(ResearchOutlineEditor, { props: { outline, topic: 'T' } })
    const title = wrapper.findAll('input')[0]
    await title.setValue('A2')
    expect((wrapper.vm as unknown as { items: Array<{ title: string }> }).items[0].title).toBe('A2')
    await wrapper.find('.research-outline-start').trigger('click')
    const emitted = wrapper.emitted('confirm')?.[0]?.[0] as Array<{ title: string }>
    expect(emitted.map(i => i.title)).toEqual(['A2', 'B'])
  })

  it('adds and removes sub-topics', async () => {
    const wrapper = mount(ResearchOutlineEditor, { props: { outline: [{ title: 'A', overview: '' }], topic: 'T' } })
    await wrapper.find('.research-outline-add').trigger('click')
    expect(wrapper.findAll('.research-outline-row')).toHaveLength(2)
    await wrapper.findAll('.research-outline-remove')[1].trigger('click')
    expect(wrapper.findAll('.research-outline-row')).toHaveLength(1)
  })

  it('disables start when every title is blank', async () => {
    const wrapper = mount(ResearchOutlineEditor, { props: { outline: [{ title: ' ', overview: '' }], topic: 'T' } })
    expect(wrapper.find('.research-outline-start').attributes('disabled')).toBeDefined()
  })

  it('locks editing while researching and collapses automatically', () => {
    const wrapper = mount(ResearchOutlineEditor, { props: { outline, topic: 'T', status: 'researching' } })
    expect(wrapper.find('.research-outline-start').exists()).toBe(false)
    expect(wrapper.find('.research-outline-static').exists()).toBe(false) // collapsed
    expect(wrapper.find('.research-outline-status').text()).toContain('研究中')
  })

  it('shows the retry label after failure and stays editable', () => {
    const wrapper = mount(ResearchOutlineEditor, { props: { outline, topic: 'T', status: 'failed' } })
    expect(wrapper.find('.research-outline-start').text()).toContain('重试研究')
  })
})
