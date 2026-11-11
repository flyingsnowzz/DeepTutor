/**
 * Research outline editing state — Vue3 port of the pure derivations in
 * web/components/research/ResearchOutlineEditor.tsx.
 */
import type { OutlineItem } from './research'

export type OutlineStatus = 'editing' | 'researching' | 'done' | 'failed'

/** Editing is locked while researching/done, or after the user confirmed. */
export function isOutlineLocked(status: OutlineStatus | undefined, localConfirmed: boolean): boolean {
  if (status === 'failed') return false
  return status === 'researching' || status === 'done' || localConfirmed
}

/**
 * Auto-collapse once locked unless the user has explicitly toggled. The
 * `userToggled` latch prevents later status re-renders from re-collapsing.
 */
export function isDisplayCollapsed(locked: boolean, userToggled: boolean, collapsed: boolean): boolean {
  return locked && (userToggled ? collapsed : true)
}

/** Resolve the next collapse state when the user clicks the header. */
export function nextCollapsed(locked: boolean, userToggled: boolean, collapsed: boolean): boolean {
  const wasAutoCollapsed = locked && !userToggled
  return wasAutoCollapsed ? false : !collapsed
}

export function updateOutlineItem(
  items: OutlineItem[],
  index: number,
  field: keyof OutlineItem,
  value: string,
): OutlineItem[] {
  return items.map((item, i) => (i === index ? { ...item, [field]: value } : item))
}

export function removeOutlineItem(items: OutlineItem[], index: number): OutlineItem[] {
  return items.filter((_, i) => i !== index)
}

export function addOutlineItem(items: OutlineItem[]): OutlineItem[] {
  return [...items, { title: '', overview: '' }]
}

/** Items with a non-blank title; values are preserved verbatim (React parity). */
export function validOutlineItems(items: OutlineItem[]): OutlineItem[] {
  return items.filter(item => item.title.trim().length > 0)
}

export function canConfirmOutline(items: OutlineItem[]): boolean {
  return validOutlineItems(items).length > 0
}

/** Items actually rendered: locked views fall back to the initial outline. */
export function displayedOutline(
  locked: boolean,
  initial: OutlineItem[],
  current: OutlineItem[],
): OutlineItem[] {
  return locked ? validOutlineItems(initial) : current
}

export type OutlineStatusTone = 'idle' | 'active' | 'success' | 'danger'

export function outlineStatusLabel(
  status: OutlineStatus | undefined,
  localConfirmed: boolean,
): { text: string; tone: OutlineStatusTone; spinner: boolean } | null {
  if (status === 'done') return { text: '研究完成', tone: 'success', spinner: false }
  if (status === 'failed') return { text: '研究失败，可重试', tone: 'danger', spinner: false }
  if (status === 'researching' || localConfirmed) return { text: '研究中', tone: 'active', spinner: true }
  return null
}

/** Confirm button label depends on whether this is a retry after failure. */
export function confirmButtonLabel(status: OutlineStatus | undefined): string {
  return status === 'failed' ? '重试研究' : '开始研究'
}
