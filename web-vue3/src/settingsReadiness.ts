export const READINESS_STATES = [
  'enabled_verified',
  'available_disabled',
  'unavailable',
  'misconfigured',
  'not_selected',
] as const
export type ReadinessState = (typeof READINESS_STATES)[number]
export type ReadinessSeverity = 'blocker' | 'warning' | 'suggestion' | null

export interface ReadinessRow {
  id: string
  section: string
  label: string
  state: ReadinessState
  detail_code: string
  enabled: boolean
  available: boolean
  configured: boolean
  verified: boolean
  required: boolean
}

export const READINESS_SECTION_ORDER = [
  'catalog',
  'knowledge',
  'document_parsing',
  'tools',
  'visualizers',
  'video_learning',
  'runtime',
] as const

const USABLE = new Set<ReadinessState>(['enabled_verified', 'available_disabled'])

export function groupReadinessRows<Row extends Pick<ReadinessRow, 'section'>>(
  rows: Row[],
): { section: string; rows: Row[] }[] {
  const grouped = new Map<string, Row[]>()
  for (const row of rows) {
    const bucket = grouped.get(row.section) ?? []
    bucket.push(row)
    grouped.set(row.section, bucket)
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => {
      const leftIndex = (READINESS_SECTION_ORDER as readonly string[]).indexOf(left)
      const rightIndex = (READINESS_SECTION_ORDER as readonly string[]).indexOf(right)
      if (leftIndex === rightIndex) return 0
      if (leftIndex === -1) return 1
      if (rightIndex === -1) return -1
      return leftIndex - rightIndex
    })
    .map(([section, groupedRows]) => ({ section, rows: groupedRows }))
}

export function readinessRowSeverity(
  row: Pick<ReadinessRow, 'state' | 'required'>,
): ReadinessSeverity {
  if (row.required && !USABLE.has(row.state)) return 'blocker'
  if (row.state === 'misconfigured') return 'warning'
  return null
}

export function isProminentReadinessRow(row: ReadinessRow): boolean {
  return row.state === 'enabled_verified' || readinessRowSeverity(row) !== null
}

export function readinessRowHref(rowId: string): string | null {
  if (rowId.startsWith('knowledge.')) return '/knowledge-bases'
  if (rowId.startsWith('catalog.')) {
    const key = rowId.slice('catalog.'.length)
    const section: Record<string, string> = {
      llm: 'llm',
      task: 'task-models',
      embedding: 'embedding',
      search: 'search',
      tts: 'voice',
      stt: 'voice',
      imagegen: 'multimodal',
      videogen: 'multimodal',
    }
    return section[key] ? `/settings/${section[key]}` : null
  }
  if (rowId.startsWith('parser.')) return '/settings/knowledge'
  if (rowId.startsWith('tool.')) return '/settings/tools'
  if (rowId.startsWith('video.')) return '/settings/video-learning'
  if (rowId.startsWith('runtime.')) return '/settings/network'
  return null
}
