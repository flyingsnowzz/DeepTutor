import { describe, expect, it } from 'vitest'
import { quizQuestionsForMessage, streamingQuizQuestions } from '../quiz/messageQuiz'

const qa = (id: string) => ({
  question_id: id,
  question: `Q ${id}`,
  question_type: 'choice',
  options: { A: 'a' },
  correct_answer: 'A',
  explanation: '',
})

const emittedEvent = (id: string, index: number) => ({
  type: 'content',
  metadata: { call_kind: 'quiz_question_emitted', question_index: index, qa_pair: qa(id) },
})

describe('quizQuestionsForMessage', () => {
  it('prefers streamed per-question events', () => {
    const result = quizQuestionsForMessage({
      events: [emittedEvent('q2', 1), emittedEvent('q1', 0)],
      metadata: { summary: { results: [{ qa_pair: qa('old') }] } },
    })
    expect(result?.map(q => q.question_id)).toEqual(['q1', 'q2'])
  })

  it('falls back to metadata summary results', () => {
    const result = quizQuestionsForMessage({
      metadata: { summary: { results: [{ qa_pair: qa('a') }, { qa_pair: qa('b') }] } },
    })
    expect(result?.map(q => q.question_id)).toEqual(['a', 'b'])
  })

  it('reads a nested result envelope', () => {
    const result = quizQuestionsForMessage({
      metadata: { result: { summary: { results: [{ qa_pair: qa('r') }] } } },
    })
    expect(result?.[0]?.question_id).toBe('r')
  })

  it('reads a result event metadata envelope', () => {
    const result = quizQuestionsForMessage({
      events: [{ type: 'result', metadata: { summary: { results: [{ qa_pair: qa('e') }] } } }],
    })
    expect(result?.[0]?.question_id).toBe('e')
  })

  it('returns null for non-quiz messages', () => {
    expect(quizQuestionsForMessage({})).toBeNull()
    expect(quizQuestionsForMessage({ events: [], metadata: {} })).toBeNull()
    expect(quizQuestionsForMessage({ metadata: { summary: { results: [] } } })).toBeNull()
  })
})

describe('streamingQuizQuestions', () => {
  it('returns emitted questions or null', () => {
    expect(streamingQuizQuestions([emittedEvent('q1', 0)])).toHaveLength(1)
    expect(streamingQuizQuestions([])).toBeNull()
    expect(streamingQuizQuestions(undefined)).toBeNull()
  })
})
