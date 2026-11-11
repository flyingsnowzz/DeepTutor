import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import QuizFollowupPanel from '../components/QuizFollowupPanel.vue'
import { EMPTY_ANSWER } from '../quiz/answerState'
import type { QuizQuestion } from '../quiz/quizModel'

vi.mock('../api', () => ({ api: vi.fn() }))

class FakeSocket {
  static instances: FakeSocket[] = []
  readyState = 1
  sent: string[] = []
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onerror?: () => void
  onclose?: () => void
  constructor(public url: string) {
    FakeSocket.instances.push(this)
    queueMicrotask(() => this.onopen?.())
  }
  send(raw: string) { this.sent.push(raw) }
  close() { this.onclose?.() }
  emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
}

const question: QuizQuestion = {
  question_id: 'q1',
  question: 'What is 2 + 2?',
  question_type: 'choice',
  options: { A: '3', B: '4' },
  correct_answer: 'B',
  explanation: 'Two plus two is four.',
}
const answer = { ...EMPTY_ANSWER, selected: 'B', submitted: true }

describe('QuizFollowupPanel', () => {
  beforeEach(() => {
    FakeSocket.instances = []
    vi.stubGlobal('WebSocket', Object.assign(FakeSocket, { OPEN: 1 }))
  })

  it('sends a follow-up chat turn with question/answer context', async () => {
    const wrapper = mount(QuizFollowupPanel, {
      props: { question, answer, parentSessionId: 'parent', turnId: 'turn1', language: 'zh' },
    })
    await wrapper.get('textarea').setValue('Why is B right?')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    const socket = FakeSocket.instances[0]
    const command = JSON.parse(socket!.sent[0]!)
    expect(command).toMatchObject({
      type: 'start_turn',
      capability: 'chat',
      content: 'Why is B right?',
      language: 'zh',
      config: {
        followup_question_context: {
          question_id: 'q1',
          user_answer: 'B',
          is_correct: true,
          parent_quiz_session_id: 'parent',
        },
      },
    })
  })

  it('streams and commits the assistant reply on done', async () => {
    const wrapper = mount(QuizFollowupPanel, { props: { question, answer } })
    await wrapper.get('textarea').setValue('Explain')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    const socket = FakeSocket.instances[0]!
    socket.emit({ type: 'content', content: 'Because ' })
    socket.emit({ type: 'content', content: 'four is 2 + 2.' })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Because four is 2 + 2.')
    socket.emit({ type: 'done' })
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.quiz-followup-assistant').at(-1)?.text()).toContain('Because four is 2 + 2.')
  })
})
