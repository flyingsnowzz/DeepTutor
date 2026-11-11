import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LearningProgressPage from '../LearningProgressPage.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn() }))
const apiMock = vi.mocked(api)
const records = {
  progress: [{ material_id: 'material-1', furthest_percentage: 0.667 }],
  activities: [{ activity_id: 'activity-1', material_id: 'material-1', action: 'highlight', extension_id: 'reading', locator: 12 }],
}

describe('LearningProgressPage', () => {
  beforeEach(() => { apiMock.mockReset() })

  it('loads material titles, clamps display percentages and renders learning activity', async () => {
    apiMock.mockImplementation(async path => {
      if (path === '/api/mastery-paths/reading/records') return records
      if (path === '/api/reading/library/materials') return { materials: [{ material_id: 'material-1', title: 'A readable title' }] }
      throw new Error(`Unexpected request: ${path}`)
    })
    const wrapper = mount(LearningProgressPage)
    await flushPromises()
    expect(wrapper.text()).toContain('A readable title')
    expect(wrapper.text()).toContain('67%')
    expect(wrapper.text()).toContain('highlight · reading · 位置 12')
    expect(wrapper.get('progress').attributes('aria-label')).toContain('A readable title')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledTimes(4)
  })

  it('shows an empty state and remains usable when the title catalogue fails', async () => {
    apiMock.mockImplementation(async path => {
      if (path === '/api/mastery-paths/reading/records') return { progress: [], activities: [] }
      throw new Error('Catalogue unavailable')
    })
    const wrapper = mount(LearningProgressPage)
    await flushPromises()
    expect(wrapper.text()).toContain('暂无学习活动')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('reports a progress request failure', async () => {
    apiMock.mockRejectedValue(new Error('Progress unavailable'))
    const wrapper = mount(LearningProgressPage)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Progress unavailable')
    expect(wrapper.text()).not.toContain('加载中')
  })
})
