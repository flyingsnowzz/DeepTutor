/**
 * Readiness notice presentation helpers — map backend notice severities
 * (blocker/warning/suggestion, from deeptutor/services/config/readiness.py)
 * onto UI tones and Chinese labels. Kept as pure functions so the mapping is
 * unit-testable independently of the StatusSettings component.
 */

export type NoticeSeverity = 'blocker' | 'warning' | 'suggestion'
export type NoticeTone = 'danger' | 'warning' | 'info'

export interface ReadinessNotice {
  code: string
  row_id: string
  section: string
  severity: string
}

const TONE_BY_SEVERITY: Record<NoticeSeverity, NoticeTone> = {
  blocker: 'danger',
  warning: 'warning',
  suggestion: 'info',
}

const LABEL_BY_SEVERITY: Record<NoticeSeverity, string> = {
  blocker: '阻断',
  warning: '警告',
  suggestion: '建议',
}

/** Map any backend severity string to a UI tone; unknown values degrade to warning. */
export function noticeTone(severity: string): NoticeTone {
  return TONE_BY_SEVERITY[severity as NoticeSeverity] ?? 'warning'
}

/** Chinese severity label; unknown values degrade to 警告. */
export function noticeSeverityLabel(severity: string): string {
  return LABEL_BY_SEVERITY[severity as NoticeSeverity] ?? '警告'
}

/** Whether a notice blocks the overall readiness "ok" flag (mirrors backend rule). */
export function noticeIsBlocking(notice: Pick<ReadinessNotice, 'severity'>): boolean {
  return notice.severity === 'blocker' || notice.severity === 'warning'
}

/** Sort notices blocker → warning → suggestion, preserving backend order within a tier. */
export function sortNotices<T extends Pick<ReadinessNotice, 'severity'>>(notices: T[]): T[] {
  const rank: Record<string, number> = { blocker: 0, warning: 1, suggestion: 2 }
  return [...notices].sort(
    (a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3),
  )
}
