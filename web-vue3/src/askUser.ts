/**
 * Extraction and normalization for `ask_user` pause cards.
 */

export interface AskUserOption {
  label: string
  description: string | null
}

export interface AskUserQuestion {
  id: string
  prompt: string
  header: string | null
  multi_select: boolean
  options: AskUserOption[]
  allow_free_text: boolean
  placeholder: string | null
}

export interface AskUserPayload {
  intro: string | null
  questions: AskUserQuestion[]
}

export interface AskUserAnswer {
  questionId: string
  text: string
}

export interface AskUserCardData {
  payload: AskUserPayload
  answers: AskUserAnswer[] | null
  resolved: boolean
  streaming?: boolean
}

interface AskUserLikeEvent {
  type?: string
  turn_id?: string
  tool_call_id?: string
  metadata?: Record<string, unknown>
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function option(value: unknown): AskUserOption | null {
  if (typeof value === 'string' && value.trim()) return { label: value.trim(), description: null }
  const raw = record(value)
  const label = string(raw.label).trim()
  if (!label) return null
  return {
    label,
    description: typeof raw.description === 'string' && raw.description.trim() ? raw.description : null,
  }
}

function question(value: unknown, index: number, usedIds: Set<string>): AskUserQuestion | null {
  const raw = record(value)
  const prompt = string(raw.prompt).trim()
  if (!prompt) return null
  let id = string(raw.id).trim() || `q_${index + 1}`
  let suffix = 2
  const base = id
  while (usedIds.has(id)) id = `${base}_${suffix++}`
  usedIds.add(id)
  const options = Array.isArray(raw.options)
    ? raw.options.map(option).filter((item): item is AskUserOption => item !== null)
    : []
  return {
    id,
    prompt,
    header: typeof raw.header === 'string' && raw.header.trim() ? raw.header : null,
    multi_select: Boolean(raw.multi_select),
    options,
    allow_free_text: raw.allow_free_text !== false,
    placeholder: typeof raw.placeholder === 'string' && raw.placeholder.trim() ? raw.placeholder : null,
  }
}

function normalizePayload(raw: unknown, allowNoQuestions = false): AskUserPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const source = record(raw)
  const rawQuestions = Array.isArray(source.questions)
    ? source.questions
    : source.question !== undefined
      ? [{ prompt: source.question, options: source.options }]
      : []
  const used = new Set<string>()
  const questions = rawQuestions
    .slice(0, 4)
    .map((item, index) => question(item, index, used))
    .filter((item): item is AskUserQuestion => item !== null)
  if (!questions.length && !allowNoQuestions) return null
  return {
    intro: typeof source.intro === 'string' && source.intro.trim() ? source.intro : null,
    questions,
  }
}

function readDraft(event: AskUserLikeEvent): { payload: AskUserPayload; callKey: string | null } | null {
  if (event.type !== 'progress') return null
  const meta = record(event.metadata)
  const payload = normalizePayload(meta.ask_user_draft, true)
  if (!payload || (!payload.intro && payload.questions.length === 0)) return null
  return {
    payload,
    callKey: typeof meta.draft_call_id === 'string' ? meta.draft_call_id.split('|', 1)[0] : null,
  }
}

/** Extract the latest interactive/resolved ask_user card from an event stream. */
export function extractAskUserPayload(
  events: AskUserLikeEvent[] | undefined,
  options: { streaming?: boolean } = {},
): AskUserCardData | null {
  if (!events?.length) return null
  let latest: { payload: AskUserPayload; toolCallId: string | null; streaming?: boolean } | null = null
  let resolution: { toolCallId: string | null; answers: AskUserAnswer[]; text: string } | null = null

  for (const event of events) {
    const meta = record(event.metadata)
    if (event.type === 'tool_result') {
      const toolMeta = record(meta.tool_metadata)
      const payload = normalizePayload(toolMeta.ask_user)
      if (!payload) continue
      latest = {
        payload,
        toolCallId:
          event.tool_call_id ?? (typeof meta.tool_call_id === 'string' ? meta.tool_call_id : null),
      }
      resolution = null
      continue
    }

    if (options.streaming) {
      const draft = readDraft(event)
      if (draft) {
        latest = { payload: draft.payload, toolCallId: draft.callKey, streaming: true }
        resolution = null
        continue
      }
    }

    if (event.type === 'progress' && meta.ask_user_resolved) {
      const answers = (Array.isArray(meta.answers) ? meta.answers : [])
        .map(value => {
          const raw = record(value)
          const questionId = String(raw.questionId ?? raw.id ?? '').trim()
          return questionId ? { questionId, text: String(raw.text ?? '') } : null
        })
        .filter((item): item is AskUserAnswer => item !== null)
      resolution = {
        toolCallId: typeof meta.ask_user_tool_call_id === 'string' ? meta.ask_user_tool_call_id : null,
        answers,
        text: typeof meta.reply_preview === 'string' ? meta.reply_preview : '',
      }
    }
  }

  if (!latest) return null
  if (resolution && (resolution.toolCallId === latest.toolCallId || latest.toolCallId === null)) {
    const answers = resolution.answers.length
      ? resolution.answers
      : latest.payload.questions[0]
        ? [{ questionId: latest.payload.questions[0].id, text: resolution.text }]
        : []
    return { payload: latest.payload, answers, resolved: true, streaming: false }
  }
  return { payload: latest.payload, answers: null, resolved: false, streaming: latest.streaming }
}

/** Build both the structured answers and the flat text the WS protocol accepts. */
export function buildAskUserReply(payload: AskUserPayload, answers: Record<string, string>) {
  const list: AskUserAnswer[] = payload.questions.map(question => ({
    questionId: question.id,
    text: (answers[question.id] ?? '').trim(),
  }))
  return {
    answers: list,
    text: list.map(answer => answer.text).filter(Boolean).join(' | '),
  }
}
