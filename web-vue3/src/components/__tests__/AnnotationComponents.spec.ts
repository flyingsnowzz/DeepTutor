import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AnnotationLayer from '../AnnotationLayer.vue'
import AnnotationList from '../AnnotationList.vue'
import AnnotationPopover from '../AnnotationPopover.vue'
import type { AnnotationItem } from '../../readingAnnotations'

const annotation: AnnotationItem = {
  annotation_id: 'a1',
  locator: 2,
  kind: 'highlight',
  color: 'blue',
  quote: 'DeepTutor',
  note: 'Important',
  rects: [[0.1, 0.2, 0.4, 0.3]],
  source_anchor: '',
  author: 'user',
  created_at: 1,
  updated_at: 1,
}

describe('annotation components', () => {
  it('renders normalized rectangles in the overlay and emits selection', async () => {
    const wrapper = mount(AnnotationLayer, {
      props: { annotations: [annotation], highlightedAnnotationId: 'a1' },
    })
    const mark = wrapper.get('.annotation-layer-mark')
    expect(mark.attributes('style')).toContain('left: 10%')
    expect(mark.attributes('style')).toContain('top: 20%')
    await mark.trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ annotation_id: 'a1' })
  })

  it('separates annotations and citations and emits delete', async () => {
    const citation: AnnotationItem = { ...annotation, annotation_id: 'c1', kind: 'citation' }
    const wrapper = mount(AnnotationList, { props: { annotations: [annotation, citation] } })
    expect(wrapper.text()).toContain('DeepTutor')
    expect(wrapper.text()).not.toContain('citation')
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
    expect(wrapper.text()).toContain('citation')
    await wrapper.get('.annotation-list-delete').trigger('click')
    expect(wrapper.emitted('delete')?.[0]?.[0]).toMatchObject({ annotation_id: 'c1' })
  })

  it('creates an annotation draft from the popover form', async () => {
    const wrapper = mount(AnnotationPopover, {
      props: {
        locator: 3,
        quote: 'Selected text',
        rects: [[0, 0, 0.5, 0.5]],
      },
    })
    await wrapper.findAll('.annotation-color-swatch')[2]!.trigger('click')
    await wrapper.get('textarea').setValue('remember this')
    await wrapper.get('.primary').trigger('click')
    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      locator: 3,
      quote: 'Selected text',
      note: 'remember this',
      color: 'blue',
      kind: 'highlight',
    })
  })
})
