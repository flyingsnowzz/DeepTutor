import { describe, expect, it } from 'vitest'
import {
  isChoiceQuizQuestion,
  isConceptQuizQuestion,
  isFillInBlankQuizQuestion,
  isFreeTextQuizQuestion,
  normalizeQuizQuestionType,
  resolveChoiceAnswerKey,
  resolveConceptAnswer,
  QUIZ_QUESTION_TYPES,
} from '../quiz/questionType'
import { decodeEscapedUnicodeForDisplay } from '../quiz/unicodeDecode'
import {
  buildQuizFollowupConfig,
  buildQuizWSConfig,
  DEFAULT_QUIZ_CONFIG,
  extractQuizQuestions,
  extractQuizTurnId,
  extractStreamingQuizQuestions,
  summarizeQuizConfig,
  type DeepQuestionFormConfig,
  type QuizQuestion,
} from '../quiz/quizModel'

describe('normalizeQuizQuestionType', () => {
  it('maps aliases onto the six canonical types', () => {
    expect(normalizeQuizQuestionType('multiple-choice')).toBe('choice')
    expect(normalizeQuizQuestionType('MCQ')).toBe('choice')
    expect(normalizeQuizQuestionType('true_false')).toBe('concept')
    expect(normalizeQuizQuestionType('cloze')).toBe('fill_in_blank')
    expect(normalizeQuizQuestionType('open-ended')).toBe('written')
    expect(normalizeQuizQuestionType('programming')).toBe('coding')
    expect(normalizeQuizQuestionType('short_answer')).toBe('short_answer')
  })

  it('normalizes whitespace/case and falls back to short_answer', () => {
    expect(normalizeQuizQuestionType('  Multiple Choice ')).toBe('choice')
    expect(normalizeQuizQuestionType('unknown-type')).toBe('short_answer')
    expect(normalizeQuizQuestionType(undefined)).toBe('short_answer')
    expect(normalizeQuizQuestionType(null)).toBe('short_answer')
  })

  it('exposes all six canonical types via the predicate helpers', () => {
    expect(QUIZ_QUESTION_TYPES).toHaveLength(6)
    expect(isChoiceQuizQuestion('mcq')).toBe(true)
    expect(isConceptQuizQuestion('tf')).toBe(true)
    expect(isFillInBlankQuizQuestion('cloze')).toBe(true)
    expect(isFreeTextQuizQuestion('essay')).toBe(true)
    expect(isFreeTextQuizQuestion('code')).toBe(true)
    expect(isFreeTextQuizQuestion('choice')).toBe(false)
  })
})

describe('resolveChoiceAnswerKey', () => {
  const options = { A: 'Paris', B: 'Berlin', C: 'Madrid' }
  it('accepts a direct option key (case-insensitive)', () => {
    expect(resolveChoiceAnswerKey('b', options)).toBe('B')
    expect(resolveChoiceAnswerKey('A', options)).toBe('A')
  })
  it('resolves an option label back to its key', () => {
    expect(resolveChoiceAnswerKey('berlin', options)).toBe('B')
    expect(resolveChoiceAnswerKey('Paris', options)).toBe('A')
  })
  it('returns empty for blank answers or missing options, else uppercases', () => {
    expect(resolveChoiceAnswerKey('', options)).toBe('')
    expect(resolveChoiceAnswerKey('A', null)).toBe('')
    expect(resolveChoiceAnswerKey('zzz', options)).toBe('ZZZ')
  })
})

describe('resolveConceptAnswer', () => {
  it('canonicalizes true/false and rejects other values', () => {
    expect(resolveConceptAnswer('TRUE')).toBe('true')
    expect(resolveConceptAnswer(' false ')).toBe('false')
    expect(resolveConceptAnswer('maybe')).toBe('')
    expect(resolveConceptAnswer(undefined)).toBe('')
  })
})

describe('decodeEscapedUnicodeForDisplay', () => {
  it('decodes dense non-ASCII unicode runs (#973)', () => {
    const escaped = '\\u4f60\\u597d\\u4e16\\u754c'
    expect(decodeEscapedUnicodeForDisplay(escaped)).toBe('你好世界')
  })
  it('leaves short runs and plain text untouched', () => {
    expect(decodeEscapedUnicodeForDisplay('plain text')).toBe('plain text')
    expect(decodeEscapedUnicodeForDisplay('\\u0041\\u0042')).toBe('\\u0041\\u0042')
    expect(decodeEscapedUnicodeForDisplay('')).toBe('')
  })
  it('does not decode runs inside fenced or inline code', () => {
    const fenced = '```\n\\u4f60\\u597d\\u4e16\\u754c\n```'
    expect(decodeEscapedUnicodeForDisplay(fenced)).toBe(fenced)
    const inline = 'see `\\u4f60\\u597d\\u4e16\\u754c` now'
    expect(decodeEscapedUnicodeForDisplay(inline)).toBe(inline)
  })
})

const baseQuestion: QuizQuestion = {
  question_id: 'q_1',
  question: 'Capital of France?',
  question_type: 'choice',
  options: { A: 'Paris', B: 'Lyon' },
  correct_answer: 'A',
  explanation: 'Paris is the capital.',
}

describe('extractStreamingQuizQuestions', () => {
  it('collects, dedupes and orders emitted questions', () => {
    const events = [
      { type: 'content', metadata: { call_kind: 'quiz_question_emitted', question_index: 1, qa_pair: { question_id: 'q2', question: 'Second', question_type: 'mcq', correct_answer: 'A', explanation: '' } } },
      { type: 'content', metadata: { call_kind: 'quiz_question_emitted', question_index: 0, qa_pair: { question_id: 'q1', question: 'First', question_type: 'tf', correct_answer: 'true', explanation: '' } } },
      { type: 'content', metadata: { call_kind: 'quiz_question_emitted', question_index: 0, qa_pair: { question_id: 'q1', question: 'First dup', question_type: 'tf', correct_answer: 'true', explanation: '' } } },
    ]
    const result = extractStreamingQuizQuestions(events)
    expect(result).not.toBeNull()
    // byId.set is unconditional in React: a later duplicate replaces the earlier one.
    expect(result?.map(q => q.question)).toEqual(['First dup', 'Second'])
    expect(result?.[0]?.question_type).toBe('concept')
  })
  it('returns null when no quiz events are present', () => {
    expect(extractStreamingQuizQuestions([])).toBeNull()
    expect(extractStreamingQuizQuestions([{ type: 'content', metadata: { call_kind: 'other' } }])).toBeNull()
    expect(extractStreamingQuizQuestions(undefined)).toBeNull()
  })
})

describe('extractQuizTurnId', () => {
  it('prefers the result event turn_id, then any event turn_id', () => {
    expect(extractQuizTurnId([{ type: 'content', turn_id: 't1' }, { type: 'result', turn_id: 't2' }])).toBe('t2')
    expect(extractQuizTurnId([{ type: 'content', turn_id: 't1' }])).toBe('t1')
    expect(extractQuizTurnId([{ type: 'result' }])).toBeNull()
    expect(extractQuizTurnId(undefined)).toBeNull()
  })
})

describe('extractQuizQuestions', () => {
  it('parses summary.results qa_pair entries and drops questions without text', () => {
    const metadata = {
      summary: {
        results: [
          { qa_pair: { question_id: 'q1', question: 'Q1', question_type: 'essay', correct_answer: 'x', explanation: 'e' } },
          { question_id: 'q2', question: 'Q2', question_type: 'code', correct_answer: 'y', explanation: 'e2' },
          { qa_pair: { question: '' } },
        ],
      },
    }
    const result = extractQuizQuestions(metadata)
    expect(result?.map(q => q.question_id)).toEqual(['q1', 'q2'])
    expect(result?.[0]?.question_type).toBe('written')
    expect(result?.[1]?.question_type).toBe('coding')
  })
  it('returns null for empty or malformed metadata', () => {
    expect(extractQuizQuestions(undefined)).toBeNull()
    expect(extractQuizQuestions({})).toBeNull()
    expect(extractQuizQuestions({ summary: { results: [] } })).toBeNull()
  })
})

describe('buildQuizFollowupConfig', () => {
  it('packages the question context with trimmed image filenames', () => {
    const config = buildQuizFollowupConfig(baseQuestion, 'my answer', true, 'parent-1', {
      userAnswerImageFilenames: [' a.png ', '', 'b.png'],
      aiJudgment: '  good  ',
    })
    const context = (config.followup_question_context as Record<string, unknown>)
    expect(context).toMatchObject({
      question_id: 'q_1',
      user_answer: 'my answer',
      is_correct: true,
      parent_quiz_session_id: 'parent-1',
      ai_judgment: 'good',
    })
    expect(context.user_answer_image_filenames).toEqual(['a.png', 'b.png'])
  })
  it('omits optional fields when not provided', () => {
    const config = buildQuizFollowupConfig(baseQuestion, '', null)
    const context = config.followup_question_context as Record<string, unknown>
    expect(context.user_answer).toBeUndefined()
    expect(context.is_correct).toBeUndefined()
    expect(context.user_answer_image_filenames).toBeUndefined()
  })
})

describe('quiz config summary and WS payload', () => {
  it('summarizes custom and mimic modes', () => {
    const custom: DeepQuestionFormConfig = { ...DEFAULT_QUIZ_CONFIG, num_questions: 5, difficulty: 'hard', question_types: [] }
    expect(summarizeQuizConfig(custom)).toContain('5 questions')
    expect(summarizeQuizConfig(custom)).toContain('Hard')
    const single: DeepQuestionFormConfig = { ...DEFAULT_QUIZ_CONFIG, question_types: ['choice'] }
    expect(summarizeQuizConfig(single)).toContain('Multiple Choice')
    const mimic: DeepQuestionFormConfig = { ...DEFAULT_QUIZ_CONFIG, mode: 'mimic', paper_path: 'paper.pdf', max_questions: 8 }
    expect(summarizeQuizConfig(mimic)).toContain('paper.pdf')
    expect(summarizeQuizConfig(mimic)).toContain('Max 8')
  })

  it('builds mimic WS config from paper path and max questions', () => {
    const mimic: DeepQuestionFormConfig = { ...DEFAULT_QUIZ_CONFIG, mode: 'mimic', paper_path: '  p.pdf  ', max_questions: 7 }
    expect(buildQuizWSConfig(mimic)).toEqual({ mode: 'mimic', paper_path: 'p.pdf', max_questions: 7 })
  })

  it('only forwards per-type counts when >=2 types and sums match', () => {
    const valid: DeepQuestionFormConfig = {
      ...DEFAULT_QUIZ_CONFIG,
      num_questions: 4,
      question_types: ['choice', 'concept'],
      per_type_counts: { choice: 2, concept: 2 },
    }
    expect(buildQuizWSConfig(valid).per_type_counts).toEqual({ choice: 2, concept: 2 })
    const mismatched: DeepQuestionFormConfig = {
      ...DEFAULT_QUIZ_CONFIG,
      num_questions: 4,
      question_types: ['choice', 'concept'],
      per_type_counts: { choice: 1, concept: 1 },
    }
    expect(buildQuizWSConfig(mismatched).per_type_counts).toEqual({})
    const singleType: DeepQuestionFormConfig = {
      ...DEFAULT_QUIZ_CONFIG,
      question_types: ['choice'],
      per_type_counts: { choice: 3 },
    }
    expect(buildQuizWSConfig(singleType).per_type_counts).toEqual({})
  })

  it('maps auto difficulty to empty string in custom payloads', () => {
    const cfg: DeepQuestionFormConfig = { ...DEFAULT_QUIZ_CONFIG, difficulty: 'auto' }
    expect(buildQuizWSConfig(cfg).difficulty).toBe('')
  })
})
