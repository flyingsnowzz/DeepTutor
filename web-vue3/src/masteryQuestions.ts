export interface MasteryEvent { type: string; turn_id?: string; seq?: number; metadata?: Record<string, unknown> }
export interface MasteryQuestionOption { label: string; body: string }
export interface MasteryVisualSource { imageUrl: string; url: string; sourcePath: string; page: number | null }
export interface MasteryQuestion {
  questionId: string
  prompt: string
  questionType: string
  objectiveName: string
  difficulty: string
  attempt: number
  options: MasteryQuestionOption[]
  allowFreeText: boolean
  questions?: MasteryQuestion[]
  visual?: { task: string; answerCues: string; keyStatus: string; hintsUsed: number; pixelsInspected?: boolean; sources: MasteryVisualSource[] }
}
export interface MasteryGrade {
  questionId: string
  isCorrect: boolean | null
  learnerAnswer: string
  correctLabel: string
  correctBody: string
  explanation: string
  result?: string
  final?: boolean
  feedback?: string
  independent?: boolean
  results?: MasteryGrade[]
  complete?: boolean
}
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
function text(value: unknown): string { return typeof value === 'string' ? value : '' }
function payload(event: MasteryEvent, key: string): unknown {
  const outer = record(event.metadata)
  const nested = record(outer?.tool_metadata)
  return nested && nested[key] !== undefined ? nested[key] : outer?.[key]
}
function parseQuestion(value: unknown): MasteryQuestion | null {
  const raw = record(value)
  const questionId = text(raw?.question_id).trim()
  if (!raw || !questionId) return null
  let questions: MasteryQuestion[] | undefined
  if (raw.question_type === 'group') {
    if (!Array.isArray(raw.questions) || raw.questions.length < 2 || raw.questions.length > 4) return null
    const parsed = raw.questions.map(parseQuestion)
    if (parsed.some(item => !item || item.questionType === 'group')) return null
    questions = parsed as MasteryQuestion[]
    if (new Set(questions.map(item => item.questionId)).size !== questions.length || questions.some(item => item.questionId === questionId)) return null
  }
  const options = Array.isArray(raw.options) ? raw.options.map(record).filter((item): item is Record<string, unknown> => Boolean(item)).map(item => ({ label: text(item.label), body: text(item.body) })).filter(item => item.label) : []
  const attempt = Number(raw.attempt)
  const visual = record(raw.visual)
  const sources = Array.isArray(visual?.sources) ? visual.sources.map(record).filter((item): item is Record<string, unknown> => Boolean(item)).filter(item => text(item.image_url).startsWith('/api/knowledge-bases/') && text(item.url).startsWith('/api/knowledge-bases/')).map(item => ({ imageUrl: text(item.image_url), url: text(item.url), sourcePath: text(item.source_path), page: typeof item.page === 'number' ? item.page : null })) : []
  return {
    questionId, prompt: text(raw.prompt), questionType: text(raw.question_type) || 'short', objectiveName: text(record(raw.objective)?.name).trim(), difficulty: text(raw.difficulty).trim(),
    attempt: Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1, options, allowFreeText: raw.allow_free_text !== false,
    ...(questions ? { questions } : {}),
    ...(visual ? { visual: { task: text(visual.task), answerCues: text(visual.answer_cues), keyStatus: text(visual.key_status), hintsUsed: Number(visual.hints_used) || 0, pixelsInspected: visual.pixels_inspected === true, sources } } : {}),
  }
}
function parseGrade(value: unknown): MasteryGrade | null {
  const raw = record(value)
  const questionId = text(raw?.question_id).trim()
  if (!raw || !questionId) return null
  const results = raw.question_type === 'group' && Array.isArray(raw.results) ? raw.results.filter(item => record(item)?.question_type !== 'group').map(parseGrade).filter((item): item is MasteryGrade => Boolean(item)) : undefined
  return {
    questionId, isCorrect: raw.is_correct === null ? null : raw.is_correct === true, learnerAnswer: text(raw.learner_answer), correctLabel: text(raw.correct_label), correctBody: text(raw.correct_body), explanation: text(raw.explanation),
    ...(text(raw.result) ? { result: text(raw.result) } : {}), final: raw.final !== false, feedback: text(raw.feedback), ...(typeof raw.independent === 'boolean' ? { independent: raw.independent } : {}), ...(results ? { results } : {}), ...(typeof raw.complete === 'boolean' ? { complete: raw.complete } : {}),
  }
}
export function collectMasteryQuestions(events?: MasteryEvent[]): MasteryQuestion[] {
  const questions = new Map<string, MasteryQuestion>()
  for (const event of events || []) {
    if (event.type !== 'tool_result') continue
    let question = parseQuestion(payload(event, 'mastery_question'))
    if (!question) {
      const askUser = record(payload(event, 'ask_user'))
      if (askUser?.kind === 'mastery_question') question = parseQuestion(askUser.mastery_question)
    }
    if (question) questions.set(question.questionId, question)
  }
  return [...questions.values()]
}
export function collectMasteryGrades(messages: Array<{ events?: MasteryEvent[] }>): Map<string, MasteryGrade> {
  const grades = new Map<string, MasteryGrade>()
  for (const message of messages) for (const event of message.events || []) {
    if (event.type !== 'tool_result') continue
    const body = record(payload(event, 'mastery_grade'))
    const grade = parseGrade(body?.result)
    if (!grade) continue
    grades.set(grade.questionId, grade)
    for (const child of grade.results || []) grades.set(child.questionId, child)
  }
  return grades
}
export function collectMasterySkips(messages: Array<{ events?: MasteryEvent[] }>): Set<string> {
  const skipped = new Set<string>()
  for (const message of messages) for (const event of message.events || []) {
    if (event.type !== 'tool_result') continue
    const body = record(payload(event, 'mastery_skip_question'))
    const questionId = text(body?.question_id).trim()
    if (body?.skipped === true && questionId) skipped.add(questionId)
  }
  return skipped
}
