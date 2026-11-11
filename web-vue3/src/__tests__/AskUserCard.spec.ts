import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AskUserCard from '../components/AskUserCard.vue'
import type { AskUserCardData } from '../askUser'

function cardData(overrides: Partial<AskUserCardData> = {}): AskUserCardData {
  return {
    payload: {
      intro: 'Choose a pace',
      questions: [{
        id: 'pace',
        prompt: 'How fast?',
        header: 'Pace',
        multi_select: false,
        options: [
          { label: 'Fast', description: 'Move quickly' },
          { label: 'Slow', description: 'Take time' },
        ],
        allow_free_text: true,
        placeholder: 'Other pace',
      }],
    },
    answers: null,
    resolved: false,
    ...overrides,
  }
}

describe('AskUserCard', () => {
  it('renders options and submits a selected label plus structured answers', async () => {
    const wrapper = mount(AskUserCard, { props: { data: cardData() } })
    expect(wrapper.text()).toContain('Choose a pace')
    expect(wrapper.text()).toContain('Move quickly')
    await wrapper.findAll('.ask-user-options button')[0]!.trigger('click')
    await wrapper.get('.ask-user-submit').trigger('click')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      text: 'Fast',
      answers: [{ questionId: 'pace', text: 'Fast' }],
    })
  })

  it('supports a custom answer and disables submit while streaming', async () => {
    const wrapper = mount(AskUserCard, { props: { data: cardData() } })
    await wrapper.get('textarea').setValue('Medium')
    await wrapper.get('.ask-user-submit').trigger('click')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      answers: [{ questionId: 'pace', text: 'Medium' }],
    })

    const streaming = mount(AskUserCard, { props: { data: cardData({ streaming: true }) } })
    expect(streaming.get('.ask-user-submit').attributes('disabled')).toBeDefined()
  })

  it('renders resolved answers read-only', () => {
    const wrapper = mount(AskUserCard, {
      props: {
        data: cardData({ resolved: true, answers: [{ questionId: 'pace', text: 'Slow' }] }),
      },
    })
    expect(wrapper.text()).toContain('已补充信息')
    expect(wrapper.text()).toContain('Slow')
    expect(wrapper.find('.ask-user-options').exists()).toBe(false)
  })
})
