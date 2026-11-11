import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import QuizQuestionCard from '../components/QuizQuestionCard.vue'
import { EMPTY_ANSWER, type AnswerState } from '../quiz/answerState'
import type { QuizQuestion } from '../quiz/quizModel'

function q(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    question_id: 'q1',
    question: 'Capital of France?',
    question_type: 'choice',
    options: { A: 'Paris', B: 'Lyon' },
    correct_answer: 'A',
    explanation: 'Paris is the capital.',
    ...overrides,
  }
}

function answer(overrides: Partial<AnswerState> = {}): AnswerState {
  return { ...EMPTY_ANSWER, ...overrides }
}

const baseProps = { index: 0, answer: answer() }

describe('QuizQuestionCard', () => {
  it('renders choice options and emits a patched answer on click', async () => {
    const wrapper = mount(QuizQuestionCard, { props: { question: q(), ...baseProps } })
    const options = wrapper.findAll('.quiz-option')
    expect(options).toHaveLength(2)
    await options[1]?.trigger('click')
    const emitted = wrapper.emitted('update:answer')?.[0]?.[0] as AnswerState
    expect(emitted.selected).toBe('B')
  })

  it('marks the correct option and shows the result after submission', () => {
    const wrapper = mount(QuizQuestionCard, {
      props: { question: q(), index: 0, answer: answer({ selected: 'A', submitted: true }) },
    })
    const options = wrapper.findAll('.quiz-option')
    expect(options[0]?.classes()).toContain('is-correct')
    expect(wrapper.text()).toContain('回答正确')
    expect(wrapper.text()).toContain('查看解析')
  })

  it('marks a wrong selection red after submission', () => {
    const wrapper = mount(QuizQuestionCard, {
      props: { question: q(), index: 0, answer: answer({ selected: 'B', submitted: true }) },
    })
    const options = wrapper.findAll('.quiz-option')
    expect(options[1]?.classes()).toContain('is-wrong')
    expect(wrapper.text()).toContain('回答错误')
  })

  it('renders true/false buttons for concept questions', async () => {
    const wrapper = mount(QuizQuestionCard, {
      props: {
        question: q({ question_type: 'concept', options: undefined, correct_answer: 'true' }),
        ...baseProps,
      },
    })
    const options = wrapper.findAll('.quiz-option-tf')
    expect(options).toHaveLength(2)
    await options[0]?.trigger('click')
    const emitted = wrapper.emitted('update:answer')?.[0]?.[0] as AnswerState
    expect(emitted.selected).toBe('true')
  })

  it('renders a text input for fill-in-the-blank and emits typed text', async () => {
    const wrapper = mount(QuizQuestionCard, {
      props: {
        question: q({ question_type: 'fill_in_blank', options: undefined, correct_answer: 'Paris' }),
        ...baseProps,
      },
    })
    const input = wrapper.find('input.quiz-answer-input')
    expect(input.exists()).toBe(true)
    await input.setValue('  Paris ')
    const emitted = wrapper.emitted('update:answer')?.[0]?.[0] as AnswerState
    expect(emitted.typed).toBe('  Paris ')
  })

  it('renders a textarea for free-text and disables submit until non-empty', async () => {
    const question = q({ question_type: 'written', options: undefined })
    const empty = mount(QuizQuestionCard, {
      props: { question, ...baseProps },
    })
    expect(empty.find('.quiz-submit').attributes('disabled')).toBeDefined()

    const emptyTextarea = empty.find('textarea.quiz-answer-input')
    await emptyTextarea.setValue('my essay')
    expect((empty.emitted('update:answer')?.[0]?.[0] as AnswerState).typed).toBe('my essay')

    // Parent-driven state: once typed text is present, submit is enabled.
    const wrapper = mount(QuizQuestionCard, {
      props: { question, index: 0, answer: answer({ typed: 'my essay' }) },
    })
    expect(wrapper.find('.quiz-submit').attributes('disabled')).toBeUndefined()
    await wrapper.find('.quiz-submit').trigger('click')
    const emitted = wrapper.emitted('submit')?.[0]?.[0] as AnswerState
    expect(emitted.submitted).toBe(true)
    expect(emitted.typed).toBe('my essay')
  })

  it('does not emit changes once submitted', async () => {
    const wrapper = mount(QuizQuestionCard, {
      props: { question: q(), index: 0, answer: answer({ selected: 'A', submitted: true }) },
    })
    await wrapper.findAll('.quiz-option')[1]?.trigger('click')
    expect(wrapper.emitted('update:answer')).toBeUndefined()
  })
})
