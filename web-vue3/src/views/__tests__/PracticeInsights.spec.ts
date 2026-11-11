import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PracticeInsights from '../PracticeInsights.vue'
import { api } from '../../api'
import { useRoute, useRouter } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: vi.fn(), useRouter: vi.fn() }))

const apiMock = vi.mocked(api)
const replace = vi.fn()
const route = {
  path: '/learning/practice',
  query: {} as Record<string, string>,
}

describe('PracticeInsights', () => {
  beforeEach(() => {
    apiMock.mockReset()
    replace.mockReset()
    route.query = {}
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockResolvedValue({
      start_date: '2026-11-09',
      end_date: '2026-11-11',
      daily: [
        { date: '2026-11-09', questions: 1, mistakes: 0, reviews: 2 },
        { date: '2026-11-10', questions: 4, mistakes: 2, reviews: 3 },
        { date: '2026-11-11', questions: 2, mistakes: 1, reviews: 6 },
      ],
      sources: [
        { source: 'mastery_path', questions: 3, mistakes: 2, reviews: 6 },
        { source: 'book', questions: 4, mistakes: 1, reviews: 5 },
      ],
      totals: { questions: 7, mistakes: 3, reviews: 11 },
    })
  })

  it('renders the selected metric, chart and source percentages', async () => {
    route.query.stats_metric = 'reviews'
    const wrapper = mount(PracticeInsights)
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/question-notebook/practice/analytics?timezone='),
    )
    expect(wrapper.text()).toContain('复习提交')
    expect(wrapper.text()).toContain('掌握路径')
    expect(wrapper.text()).toContain('55%')
    expect(wrapper.find('svg[role="img"]').exists()).toBe(true)
  })

  it('persists metric changes in the route', async () => {
    const wrapper = mount(PracticeInsights)
    await flushPromises()
    await wrapper.findAll('.practice-metrics button')[1]?.trigger('click')
    expect(replace).toHaveBeenCalledWith({
      path: '/learning/practice',
      query: { stats_metric: 'mistakes' },
    })
  })
})
