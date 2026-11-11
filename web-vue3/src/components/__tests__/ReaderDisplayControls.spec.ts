import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReaderDisplayControls from '../ReaderDisplayControls.vue'
import { DEFAULT_READER_DISPLAY_PREFERENCES } from '../../readingDisplay'

describe('ReaderDisplayControls', () => {
  it('emits font, width, theme and reset changes', async () => {
    const wrapper = mount(ReaderDisplayControls, {
      props: { preferences: DEFAULT_READER_DISPLAY_PREFERENCES },
    })
    const buttons = wrapper.findAll('button')
    await buttons[1]!.trigger('click')
    expect(wrapper.emitted('change')?.[0]?.[0]).toMatchObject({ fontSize: 18 })
    await buttons[3]!.trigger('click')
    expect(wrapper.emitted('change')?.[1]?.[0]).toMatchObject({ lineWidth: 104 })
    await buttons[4]!.trigger('click')
    expect(wrapper.emitted('change')?.[2]?.[0]).toMatchObject({ readerTheme: 'sepia' })
    await buttons.at(-1)!.trigger('click')
    expect(wrapper.emitted('change')?.at(-1)?.[0]).toEqual(DEFAULT_READER_DISPLAY_PREFERENCES)
  })

  it('shows the spread control only for EPUB', async () => {
    const wrapper = mount(ReaderDisplayControls, {
      props: { preferences: DEFAULT_READER_DISPLAY_PREFERENCES },
    })
    expect(wrapper.findAll('button')).toHaveLength(6)
    await wrapper.setProps({ showSpread: true })
    expect(wrapper.findAll('button')).toHaveLength(7)
  })
})
