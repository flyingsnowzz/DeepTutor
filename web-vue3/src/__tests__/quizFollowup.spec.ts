import { describe, expect, it } from 'vitest'
import { EMPTY_ANSWER, type AnswerState } from '../quiz/answerState'
import {
  applyQuizFollowupEvent,
  buildQuizFollowupStartCommand,
  emptyQuizFollowupState,
  quizFollowupContext,
} from '../quiz/quizFollowup'
import type { QuizQuestion } from '../quiz/quizModel'

const question: QuizQuestion = {
  question_id: 'q1',
  question: '2 + 2?',
  question_type: 'choice',
  options: { A: '3', B: '4' },
  correct_answer: 'B',
  explanation: 'Four.',
}
const answer: AnswerState = { ...EMPTY_ANSWER, selected: 'B', submitted: true }

describe('quiz follow-up', () => {
  it('builds a chat capability command with question context and answer images', () => {
    const command = buildQuizFollowupStartCommand({
      question,
      answer: {
        ...answer,
        images: [{ id: 'img1', base64: 'abc', filename: 'work.png', mime_type: 'image/png', url: '' }],
      },
      userAnswer: 'B',
      isCorrect: true,
      parentSessionId: 'parent',
      sessionId: 'followup',
      turnId: 'turn1',
      content: 'Why?',
      language: 'zh',
    })
    expect(command).toMatchObject({
      capability: 'chat',
      content: 'Why?',
      session_id: 'followup',
      language: 'zh',
      attachments: [{ type: 'image', filename: 'work.png', base64: 'abc' }],
      config: {
        followup_question_context: {
          question_id: 'q1',
          parent_quiz_session_id: 'parent',
          user_answer: 'B',
          is_correct: true,
          user_answer_image_filenames: ['work.png'],
        },
      },
    })
  })

  it('streams content and commits one assistant message on done', () => {
    let state = { ...emptyQuizFollowupState(), busy: true }
    state = applyQuizFollowupEvent(state, {
      type: 'session_meta',
      session_id: 's1',
      turn_id: 't1',
      metadata: { session_id: 's1', turn_id: 't1' },
    })
    state = applyQuizFollowupEvent(state, { type: 'tool_call', content: 'search' })
    state = applyQuizFollowupEvent(state, { type: 'content', content: 'Because ' })
    state = applyQuizFollowupEvent(state, { type: 'content', content: 'four.' })
    state = applyQuizFollowupEvent(state, { type: 'done' })
    expect(state.sessionId).toBe('s1')
    expect(state.messages).toEqual([
      { role: 'assistant', content: 'Because four.', events: [{ type: 'tool_call', content: 'search' }] },
    ])
    expect(state.busy).toBe(false)
    expect(state.streaming).toBe('')
  })

  it('captures errors and derives the answer context', () => {
    const state = applyQuizFollowupEvent(
      { ...emptyQuizFollowupState(), busy: true },
      { type: 'error', message: 'offline' },
    )
    expect(state.error).toBe('offline')
    expect(state.busy).toBe(false)
    expect(quizFollowupContext(question, answer)).toEqual({ userAnswer: 'B', isCorrect: true })
  })
})
