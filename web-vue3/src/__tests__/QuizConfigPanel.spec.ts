import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import QuizConfigPanel from '../components/QuizConfigPanel.vue'
import { DEFAULT_QUIZ_CONFIG, type DeepQuestionFormConfig } from '../quiz/quizModel'

const cfg = (overrides: Partial<DeepQuestionFormConfig> = {}): DeepQuestionFormConfig => ({
  ...DEFAULT_QUIZ_CONFIG,
  ...overrides,
})

function lastEmit(wrapper: ReturnType<typeof mount>): DeepQuestionFormConfig {
  const events = wrapper.emitted('update:modelValue') ?? []
  return events[events.length - 1]?.[0] as DeepQuestionFormConfig
}

describe('QuizConfigPanel', () => {
  it('renders the summary and mode toggle', () => {
    const wrapper = mount(QuizConfigPanel, { props: { modelValue: cfg() } })
    expect(wrapper.text()).toContain('出题设置')
    expect(wrapper.text()).toContain('自定义')
    expect(wrapper.text()).toContain('模仿试卷')
  })

  it('switches to mimic mode and exposes paper fields', async () => {
    const wrapper = mount(QuizConfigPanel, { props: { modelValue: cfg() } })
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[1]?.trigger('click')
    expect(lastEmit(wrapper).mode).toBe('mimic')
  })

  it('shows paper path and max questions in mimic mode', () => {
    const wrapper = mount(QuizConfigPanel, {
      props: { modelValue: cfg({ mode: 'mimic' }) },
    })
    expect(wrapper.find('[aria-label="试卷路径"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="最多题目数"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('请先选择试卷')
  })

  it('toggles a question type and rebalances to a two-type split', async () => {
    const wrapper = mount(QuizConfigPanel, {
      props: {
        modelValue: cfg({
          num_questions: 5,
          question_types: ['choice'],
          per_type_counts: {},
        }),
      },
    })
    const chips = wrapper.findAll('.quiz-type-chip')
    // concept is the second canonical type
    await chips[1]?.trigger('click')
    const next = lastEmit(wrapper)
    expect(next.question_types).toEqual(['choice', 'concept'])
    expect(next.per_type_counts).toEqual({ choice: 3, concept: 2 })
  })

  it('shows the ratio bar when two or more types are selected', () => {
    const wrapper = mount(QuizConfigPanel, {
      props: {
        modelValue: cfg({
          num_questions: 4,
          question_types: ['choice', 'concept'],
          per_type_counts: { choice: 3, concept: 1 },
        }),
      },
    })
    expect(wrapper.find('.quiz-ratio').exists()).toBe(true)
    expect(wrapper.text()).toContain('合计 4 / 4')
    expect(wrapper.find('.quiz-ratio-bar').exists()).toBe(true)
  })

  it('updates difficulty and count through receipts', async () => {
    const wrapper = mount(QuizConfigPanel, { props: { modelValue: cfg() } })
    await wrapper.find('[aria-label="难度"]').setValue('hard')
    expect(lastEmit(wrapper).difficulty).toBe('hard')
    await wrapper.find('[aria-label="题目数量"]').setValue('8')
    expect(lastEmit(wrapper).num_questions).toBe(8)
  })

  it('clears per-type counts when dropping to one type', async () => {
    const wrapper = mount(QuizConfigPanel, {
      props: {
        modelValue: cfg({
          question_types: ['choice', 'concept'],
          per_type_counts: { choice: 2, concept: 2 },
        }),
      },
    })
    await wrapper.findAll('.quiz-type-chip')[1]?.trigger('click')
    expect(lastEmit(wrapper).per_type_counts).toEqual({})
  })
})
