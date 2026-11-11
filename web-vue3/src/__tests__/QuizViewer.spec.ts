import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import QuizViewer from '../components/QuizViewer.vue'
import type { QuizQuestion } from '../quiz/quizModel'

function q(id: string, overrides: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    question_id: id,
    question: `Question ${id}`,
    question_type: 'choice',
    options: { A: 'A', B: 'B' },
    correct_answer: 'A',
    explanation: 'because',
    ...overrides,
  }
}

describe('QuizViewer', () => {
  it('renders progress, count and first question', () => {
    const wrapper = mount(QuizViewer, { props: { questions: [q('1'), q('2')] } })
    expect(wrapper.text()).toContain('1 / 2')
    expect(wrapper.text()).toContain('0 / 2 已作答')
    const bar = wrapper.find('[role="progressbar"]')
    expect(bar.attributes('aria-valuenow')).toBe('50')
  })

  it('navigates with prev/next and emits change', async () => {
    const wrapper = mount(QuizViewer, { props: { questions: [q('1'), q('2')] } })
    const next = wrapper.find('[aria-label="下一题"]')
    await next.trigger('click')
    expect(wrapper.emitted('change')?.[0]).toEqual([1])
    expect(wrapper.text()).toContain('2 / 2')
    expect(wrapper.find('[aria-label="下一题"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[aria-label="上一题"]').trigger('click')
    expect(wrapper.emitted('change')?.[1]).toEqual([0])
  })

  it('advances after submitting a non-final answer', async () => {
    const wrapper = mount(QuizViewer, { props: { questions: [q('1'), q('2')] } })
    await wrapper.findAll('.quiz-option')[0]?.trigger('click')
    await wrapper.find('.quiz-submit').trigger('click')
    expect(wrapper.find('.quiz-question-index').text()).toBe('2')
    expect(wrapper.text()).toContain('1 / 2 已作答')
  })

  it('emits submit on the final answer', async () => {
    const wrapper = mount(QuizViewer, { props: { questions: [q('1')] } })
    await wrapper.findAll('.quiz-option')[0]?.trigger('click')
    await wrapper.find('.quiz-submit').trigger('click')
    const results = wrapper.emitted('submit')?.[0]?.[0] as Array<{ question_id: string; is_correct: boolean }>
    expect(results).toHaveLength(1)
    expect(results[0]?.question_id).toBe('1')
    expect(results[0]?.is_correct).toBe(true)
  })

  it('retries a submitted question while keeping it in the session', async () => {
    const wrapper = mount(QuizViewer, { props: { questions: [q('1')] } })
    await wrapper.findAll('.quiz-option')[0]?.trigger('click')
    await wrapper.find('.quiz-submit').trigger('click')
    expect(wrapper.text()).toContain('回答正确')
    await wrapper.find('.quiz-viewer-retry').trigger('click')
    expect(wrapper.text()).toContain('提交答案')
  })

  it('opens the follow-up panel for a submitted question', async () => {
    const wrapper = mount(QuizViewer, {
      props: { questions: [q('1')], sessionId: 's1', turnId: 't1', language: 'zh' },
      global: {
        stubs: { QuizFollowupPanel: { template: '<div class="followup-stub" />' } },
      },
    })
    await wrapper.findAll('.quiz-option')[0]?.trigger('click')
    await wrapper.find('.quiz-submit').trigger('click')
    const toggle = wrapper.find('.quiz-followup-toggle')
    expect(toggle.exists()).toBe(true)
    expect(wrapper.find('.followup-stub').exists()).toBe(false)
    await toggle.trigger('click')
    expect(wrapper.find('.followup-stub').exists()).toBe(true)
  })

  it('shows an empty state without questions', () => {
    const wrapper = mount(QuizViewer, { props: { questions: [] } })
    expect(wrapper.text()).toContain('暂无题目')
  })
})
