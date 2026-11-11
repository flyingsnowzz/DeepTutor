export type PracticeRating = 'again' | 'hard' | 'good' | 'easy'
export type PracticeMetric = 'questions' | 'mistakes' | 'reviews'

export interface PracticeSummary {
  total: number
  mistakes: number
  due: number
  overdue: number
  reviewed_today: number
  next_due_at: number | null
}

export interface PracticeRef {
  id: number
  workspaceId?: string
  workspaceName?: string
}

export interface PracticeCategory {
  id: number
  name: string
}

export interface PracticeEntry {
  id: number
  question: string
  question_type?: string
  options?: Record<string, string>
  correct_answer?: string
  explanation?: string
  material_title?: string
  categories?: PracticeCategory[] | null
}

export interface PracticeQuestion {
  content_workspace_id?: string
  content_workspace_name?: string
  entry: PracticeEntry
  state: { version: number }
}

export interface PracticeReviewResult {
  due_at: number
  correct?: boolean | null
  rating?: PracticeRating
  is_mistake?: boolean
}

export interface PracticeCounts {
  questions: number
  mistakes: number
  reviews: number
}

export interface PracticeDailyCounts extends PracticeCounts {
  date: string
}

export interface PracticeSourceCounts extends PracticeCounts {
  source: string
}

export interface PracticeAnalytics {
  start_date: string
  end_date: string
  daily: PracticeDailyCounts[]
  sources: PracticeSourceCounts[]
  totals: PracticeCounts
}

type QueryValue = unknown
type QueryRecord = Record<string, QueryValue>

function queryStrings(value: QueryValue): string[] {
  const raw = Array.isArray(value) ? value : [value]
  return raw.flatMap(item => (typeof item === 'string' ? item.split(',') : []))
}

function positiveId(value: string): number | null {
  const id = Number(value.trim())
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function firstQueryString(query: QueryRecord, key: string): string {
  return queryStrings(query[key]).find(Boolean)?.trim() || ''
}

/**
 * Resolve the manual practice deep link used by the question bank.
 *
 * `questions` is the collection entry point. `question` remains supported
 * because activity feeds and older links still use the single-question form.
 */
export function practiceRefsFromQuery(query: QueryRecord): PracticeRef[] {
  const workspaceId = firstQueryString(query, 'dt_workspace') || firstQueryString(query, 'workspace')
  const source = queryStrings(query.questions).length
    ? queryStrings(query.questions)
    : queryStrings(query.question)
  const seen = new Set<number>()
  const refs: PracticeRef[] = []
  for (const value of source) {
    const id = positiveId(value)
    if (id === null || seen.has(id)) continue
    seen.add(id)
    refs.push({ id, ...(workspaceId ? { workspaceId } : {}) })
  }
  return refs
}

/** Older answer prompts sometimes put a fenced block directly after prose. */
export function practiceMarkdown(content: string): string {
  return content.replace(/([^\n])(```[\w+-]*[ \t]*\r?\n)/g, '$1\n\n$2')
}

export function practiceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function scheduledLaterCount(summary: PracticeSummary | null): number | null {
  return summary === null ? null : Math.max(0, summary.total - summary.due)
}

export function nextReviewDue(current: number | null, dueAt: number): number | null {
  if (!Number.isFinite(dueAt) || dueAt <= 0) return current
  return current === null ? dueAt : Math.min(current, dueAt)
}

export interface PracticeReviewProgress {
  queue: PracticeRef[]
  saved: number
  nextDue: number | null
}

export function practiceReviewProgress(
  queue: PracticeRef[],
  current: PracticeRef,
  saved: number,
  nextDue: number | null,
  rating: PracticeRating,
  result: PracticeReviewResult,
): PracticeReviewProgress {
  return {
    queue: rating === 'again' ? [...queue, current] : queue,
    saved: rating === 'again' ? saved : saved + 1,
    nextDue: nextReviewDue(nextDue, result.due_at),
  }
}

export type PracticeChartStyle = 'line' | 'bars'

export interface PracticeChartPoint {
  date: string
  value: number
  x: number
  y: number
}

export interface PracticeChartBar extends PracticeChartPoint {
  width: number
  height: number
}

export interface PracticeChartGeometry {
  left: number
  right: number
  bottom: number
  height: number
  top: number
  unit: number
  points: PracticeChartPoint[]
  bars: PracticeChartBar[]
  linePath: string
  areaPath: string
  ticks: number[]
  dateIndexes: number[]
}

/** Pure geometry shared by the rendered chart and its unit tests. */
export function practiceChartGeometry(
  rows: PracticeDailyCounts[],
  metric: PracticeMetric,
  requestedWidth: number,
): PracticeChartGeometry {
  const width = Math.max(240, requestedWidth)
  const left = 32
  const right = width - 12
  const bottom = 156
  const height = 136
  const maximum = Math.max(1, ...rows.map(row => row[metric]))
  const step = Math.max(1, 10 ** Math.floor(Math.log10(maximum)))
  const top = Math.ceil(maximum / step) * step
  const unit = rows.length ? (right - left) / rows.length : 0
  const x = (index: number) => left + (index + 0.5) * unit
  const y = (value: number) => bottom - (value / top) * height
  const points = rows.map((row, index) => ({
    date: row.date,
    value: row[metric],
    x: x(index),
    y: y(row[metric]),
  }))
  const linePath = points
    .map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`)
    .join(' ')
  const first = points[0]
  const last = points.at(-1)
  return {
    left,
    right,
    bottom,
    height,
    top,
    unit,
    points,
    bars: points.map(point => ({
      ...point,
      width: Math.max(1, unit * 0.64),
      height: bottom - point.y,
    })),
    linePath,
    areaPath:
      first && last
        ? `${linePath} L${last.x},${bottom} L${first.x},${bottom} Z`
        : '',
    ticks: [...new Set([0, Math.floor(top / 2), top])],
    dateIndexes: rows.length
      ? [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])].filter(
          index => index >= 0,
        )
      : [],
  }
}

export function activePracticePoint(
  rows: PracticeDailyCounts[],
  metric: PracticeMetric,
  geometry: PracticeChartGeometry,
  selectedDate: string,
): { index: number; row: PracticeDailyCounts | undefined; point: PracticeChartPoint | undefined } {
  const selected = rows.findIndex(row => row.date === selectedDate)
  const index = selected >= 0 ? selected : Math.max(0, rows.length - 1)
  return { index, row: rows[index], point: geometry.points[index] }
}
