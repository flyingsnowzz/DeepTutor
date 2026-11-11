import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WatchingMarksPanel from '../WatchingMarksPanel.vue'
import type { VideoLearningMark, VideoMarkSuggestion } from '../../videoLearning'

const mark: VideoLearningMark = {
  mark_id: 'm1',
  kind: 'review',
  start_seconds: 12,
  end_seconds: 20,
  start_locator: 2,
  end_locator: 3,
  quote: 'Important review point',
  note: 'before exam',
  author: 'user',
  created_at: '',
  updated_at: '',
}

const suggestion: VideoMarkSuggestion = {
  kind: 'key_point',
  start_seconds: 30,
  end_seconds: 35,
  start_locator: 4,
  end_locator: 4,
  quote: 'Definition',
  note: '',
  author: 'assistant',
}

describe('WatchingMarksPanel', () => {
  it('renders marks, supports filters and emits seek/delete/review', async () => {
    const wrapper = mount(WatchingMarksPanel, {
      props: { marks: [mark], currentTime: 13 },
    })
    expect(wrapper.text()).toContain('Important review point')
    expect(wrapper.get('article').classes()).toContain('active')
    await wrapper.findAll('.watching-time-link')[0]!.trigger('click')
    expect(wrapper.emitted('seek')?.[0]).toEqual([12])
    await wrapper.get('[aria-label="标记为已复习"]').trigger('click')
    expect(wrapper.emitted('review')?.[0]?.[0]).toMatchObject({ mark_id: 'm1' })
    await wrapper.get('[aria-label="删除标记"]').trigger('click')
    expect(wrapper.emitted('delete')?.[0]).toEqual(['m1'])
    await wrapper.findAll('.watching-mark-filters button')[1]!.trigger('click')
    expect(wrapper.text()).toContain('还没有标记。')
  })

  it('renders and saves suggested marks', async () => {
    const wrapper = mount(WatchingMarksPanel, {
      props: { marks: [], suggestions: [suggestion] },
    })
    expect(wrapper.text()).toContain('建议标记')
    await wrapper.get('.watching-mark-suggestions .primary').trigger('click')
    expect(wrapper.emitted('save-suggestion')?.[0]?.[0]).toEqual(suggestion)
  })
})
