import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PracticeTrendChart from '../PracticeTrendChart.vue'

const rows = [
  { date: '2026-11-09', questions: 1, mistakes: 0, reviews: 2 },
  { date: '2026-11-10', questions: 4, mistakes: 2, reviews: 3 },
  { date: '2026-11-11', questions: 2, mistakes: 1, reviews: 6 },
]

describe('PracticeTrendChart', () => {
  it('shows the latest point and supports keyboard inspection', async () => {
    const wrapper = mount(PracticeTrendChart, {
      props: { rows, metric: 'reviews', color: '#329080', label: '复习提交', style: 'line' },
    })
    expect(wrapper.text()).toContain('6')
    const chart = wrapper.get('[role="group"]')
    await chart.trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.text()).toContain('3')
    await chart.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.text()).toContain('6')
  })

  it('renders bars and an empty state-safe chart', () => {
    const wrapper = mount(PracticeTrendChart, {
      props: { rows, metric: 'mistakes', color: '#d08732', label: '新增错题', style: 'bars' },
    })
    expect(wrapper.findAll('rect').length).toBeGreaterThan(rows.length)
    expect(wrapper.find('path').exists()).toBe(false)
  })
})
