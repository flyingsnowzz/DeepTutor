/**
 * Quiz data model and extraction/build helpers — Vue3 port of the pure
 * functions in web/lib/quiz-types.ts. No React/DOM dependencies.
 */
import { decodeEscapedUnicodeForDisplay } from './unicodeDecode'
import { normalizeQuizQuestionType, type NormalizedQuizQuestionType } from './questionType'

export type DeepQuestionMode = 'custom' | 'mimic'

export interface DeepQuestionFormConfig {
  mode: DeepQuestionMode
  topic: string
  num_questions: number
  difficulty: string
  question_types: NormalizedQuizQuestionType[]
  per_type_counts: Partial<Record<NormalizedQuizQuestionType, number>>
  paper_path: string
  max_questions: number
}

export const DEFAULT_QUIZ_CONFIG: DeepQuestionFormConfig = {
  mode: 'custom',
  topic: '',
  num_questions: 3,
  difficulty: 'auto',
  question_types: [],
  per_type_counts: {},
  paper_path: '',
  max_questions: 10,
}

export interface QuizQuestion {
  question_id: string
  question: string
  question_type: NormalizedQuizQuestionType
  options?: Record<string, string>
  correct_answer: string
  explanation: string
  difficulty?: string
  concentration?: string
  knowledge_context?: string
}

export interface QuizFollowupContext {
  parent_quiz_session_id?: string
  question_id: string
  question: string
  question_type: QuizQuestion['question_type']
  options?: Record<string, string>
  correct_answer: string
  explanation: string
  difficulty?: string
  concentration?: string
  knowledge_context?: string
  user_answer?: string
  is_correct?: boolean
  user_answer_image_filenames?: string[]
  ai_judgment?: string
}

function decodeQuizText(value: string | undefined | null): string {
  return decodeEscapedUnicodeForDisplay(String(value ?? ''))
}

function decodeQuizOptions(
  options: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!options || typeof options !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(options)) {
    out[key] = decodeQuizText(value)
  }
  return out
}

function buildQuizQuestionFromQa(qa: Record<string, unknown>): QuizQuestion {
  const metadata = qa.metadata
  const knowledgeContext =
    metadata && typeof metadata === 'object' && 'knowledge_context' in metadata
      ? decodeQuizText(String((metadata as Record<string, unknown>).knowledge_context))
      : undefined
  return {
    question_id: String(qa.question_id ?? ''),
    question: decodeQuizText(qa.question as string | undefined | null),
    question_type: normalizeQuizQuestionType(qa.question_type),
    options: decodeQuizOptions(qa.options as Record<string, string> | undefined),
    correct_answer: decodeQuizText(qa.correct_answer as string | undefined | null),
    explanation: decodeQuizText(qa.explanation as string | undefined | null),
    difficulty: qa.difficulty ? String(qa.difficulty) : undefined,
    concentration: qa.concentration ? String(qa.concentration) : undefined,
    knowledge_context: knowledgeContext,
  }
}

interface StreamEvent {
  type?: string
  metadata?: Record<string, unknown>
}

/**
 * Collect live quiz questions from per-question content events, deduped by
 * question_id and ordered by question_index. Returns null until a valid quiz
 * event arrives, so callers can fall back to the legacy result envelope.
 */
export function extractStreamingQuizQuestions(
  events: StreamEvent[] | undefined,
): QuizQuestion[] | null {
  if (!Array.isArray(events) || events.length === 0) return null
  const byId = new Map<string, { idx: number; qa: QuizQuestion }>()
  for (const event of events) {
    if (event.type !== 'content') continue
    const meta = (event.metadata ?? {}) as Record<string, unknown>
    if (meta.call_kind !== 'quiz_question_emitted') continue
    const qa = meta.qa_pair as Record<string, unknown> | undefined
    if (!qa || typeof qa !== 'object' || !qa.question) continue
    const idx = Number(meta.question_index)
    const question = buildQuizQuestionFromQa(qa)
    const key = question.question_id || String(idx)
    byId.set(key, { idx: Number.isFinite(idx) ? idx : byId.size, qa: question })
  }
  if (byId.size === 0) return null
  return Array.from(byId.values())
    .sort((a, b) => a.idx - b.idx)
    .map(entry => entry.qa)
}

interface TurnEvent {
  type?: string
  turn_id?: string
}

/** Resolve the turn identity of a quiz message from its event stream. */
export function extractQuizTurnId(events: TurnEvent[] | undefined): string | null {
  if (!Array.isArray(events)) return null
  const result = events.find(event => event.type === 'result' && event.turn_id)
  if (result?.turn_id) return result.turn_id
  return events.find(event => event.turn_id)?.turn_id ?? null
}

/** Extract QuizQuestion[] from the raw `result` event metadata. */
export function extractQuizQuestions(
  resultMetadata: Record<string, unknown> | undefined,
): QuizQuestion[] | null {
  if (!resultMetadata) return null
  const summary = resultMetadata.summary as Record<string, unknown> | undefined
  if (!summary) return null
  const results = summary.results as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(results) || results.length === 0) return null

  const parsed: Array<QuizQuestion | null> = results.map(item => {
    const qa = (item.qa_pair ?? item) as Record<string, unknown>
    if (!qa.question) return null
    return buildQuizQuestionFromQa(qa)
  })

  return parsed.filter((question): question is QuizQuestion => question !== null)
}

export interface QuizFollowupExtras {
  userAnswerImageFilenames?: string[] | null
  aiJudgment?: string | null
}

export function buildQuizFollowupConfig(
  question: QuizQuestion,
  userAnswer: string,
  isCorrect: boolean | null,
  parentQuizSessionId?: string | null,
  extras?: QuizFollowupExtras,
): Record<string, unknown> {
  const filenames = (extras?.userAnswerImageFilenames ?? [])
    .map(name => (typeof name === 'string' ? name.trim() : ''))
    .filter(name => name.length > 0)
  const context: QuizFollowupContext = {
    question_id: question.question_id,
    question: question.question,
    question_type: question.question_type,
    options: question.options,
    correct_answer: question.correct_answer,
    explanation: question.explanation,
    difficulty: question.difficulty,
    concentration: question.concentration,
    knowledge_context: question.knowledge_context,
    user_answer: userAnswer || undefined,
    is_correct: typeof isCorrect === 'boolean' ? isCorrect : undefined,
    parent_quiz_session_id: parentQuizSessionId || undefined,
    user_answer_image_filenames: filenames.length > 0 ? filenames : undefined,
    ai_judgment: extras?.aiJudgment?.trim() || undefined,
  }
  return { followup_question_context: context }
}

function titleCase(value: string): string {
  if (!value) return ''
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export const QUIZ_TYPE_LABEL_KEYS: Record<NormalizedQuizQuestionType, string> = {
  choice: 'Multiple Choice',
  concept: 'Concept Question',
  fill_in_blank: 'Fill in the Blank',
  short_answer: 'Short Answer',
  written: 'Essay',
  coding: 'Coding',
}

/** One-line summary of the quiz form shown next to the collapsed settings. */
export function summarizeQuizConfig(
  cfg: DeepQuestionFormConfig,
  translate?: (key: string) => string,
): string {
  const tr = translate ?? ((s: string) => s)
  if (cfg.mode === 'mimic') {
    const target = cfg.paper_path.trim() || tr('no paper')
    return [tr('Mimic Paper'), target, `${tr('Max')} ${cfg.max_questions}`].join(' · ')
  }
  const firstType = cfg.question_types[0]
  const typeSummary =
    cfg.question_types.length === 0
      ? tr('Auto')
      : cfg.question_types.length === 1 && firstType
        ? tr(QUIZ_TYPE_LABEL_KEYS[firstType])
        : `${cfg.question_types.length} ${tr('types')}`
  return [
    tr('Custom'),
    `${cfg.num_questions} ${tr('questions')}`,
    tr(titleCase(cfg.difficulty || 'auto')),
    typeSummary,
  ].join(' · ')
}

/** Build the `config` payload to send over WebSocket for quiz generation. */
export function buildQuizWSConfig(cfg: DeepQuestionFormConfig): Record<string, unknown> {
  if (cfg.mode === 'mimic') {
    return {
      mode: 'mimic',
      paper_path: cfg.paper_path.trim(),
      max_questions: cfg.max_questions,
    }
  }
  const countsValid =
    cfg.question_types.length >= 2 &&
    Object.keys(cfg.per_type_counts).length > 0 &&
    Object.values(cfg.per_type_counts).reduce((sum, v) => sum + (v || 0), 0) ===
      cfg.num_questions
  return {
    mode: 'custom',
    num_questions: cfg.num_questions,
    difficulty: cfg.difficulty === 'auto' ? '' : cfg.difficulty,
    question_types: cfg.question_types,
    per_type_counts: countsValid ? cfg.per_type_counts : {},
  }
}
