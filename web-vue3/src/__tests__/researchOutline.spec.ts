import { describe, expect, it } from 'vitest'
import {
  addOutlineItem,
  canConfirmOutline,
  confirmButtonLabel,
  displayedOutline,
  isDisplayCollapsed,
  isOutlineLocked,
  nextCollapsed,
  outlineStatusLabel,
  removeOutlineItem,
  updateOutlineItem,
  validOutlineItems,
} from '../researchOutline'

const outline = [
  { title: 'A', overview: 'a' },
  { title: ' ', overview: 'blank' },
  { title: 'C', overview: 'c' },
]

describe('isOutlineLocked', () => {
  it('locks researching/done/confirmed and unlocks failed/editing', () => {
    expect(isOutlineLocked('researching', false)).toBe(true)
    expect(isOutlineLocked('done', false)).toBe(true)
    expect(isOutlineLocked('editing', true)).toBe(true)
    expect(isOutlineLocked('failed', true)).toBe(false)
    expect(isOutlineLocked('editing', false)).toBe(false)
  })
})

describe('collapse behavior', () => {
  it('auto-collapses only when locked and not user-toggled', () => {
    expect(isDisplayCollapsed(true, false, false)).toBe(true)
    expect(isDisplayCollapsed(true, true, false)).toBe(false)
    expect(isDisplayCollapsed(false, false, false)).toBe(false)
  })
  it('first click on auto-collapsed expands, subsequent clicks toggle', () => {
    expect(nextCollapsed(true, false, false)).toBe(false)
    expect(nextCollapsed(true, true, false)).toBe(true)
    expect(nextCollapsed(true, true, true)).toBe(false)
    expect(nextCollapsed(false, false, false)).toBe(true)
  })
})

describe('item operations', () => {
  it('updates only the target item field', () => {
    const next = updateOutlineItem(outline, 0, 'title', 'A2')
    expect(next[0]).toEqual({ title: 'A2', overview: 'a' })
    expect(next[1]).toEqual(outline[1])
  })
  it('removes by index and appends a blank item', () => {
    expect(removeOutlineItem(outline, 1)).toEqual([outline[0], outline[2]])
    expect(addOutlineItem([])).toEqual([{ title: '', overview: '' }])
  })
})

describe('validOutlineItems / canConfirm', () => {
  it('filters blank titles and gates confirm', () => {
    expect(validOutlineItems(outline)).toEqual([outline[0], outline[2]])
    expect(canConfirmOutline(outline)).toBe(true)
    expect(canConfirmOutline([{ title: '  ', overview: '' }])).toBe(false)
  })
})

describe('displayedOutline', () => {
  it('shows initial valid items when locked and live items otherwise', () => {
    const current = [{ title: 'edited', overview: 'x' }]
    expect(displayedOutline(true, outline, current)).toEqual([outline[0], outline[2]])
    expect(displayedOutline(false, outline, current)).toBe(current)
  })
})

describe('status helpers', () => {
  it('maps status to labels/tones and retry button copy', () => {
    expect(outlineStatusLabel('done', false)).toMatchObject({ tone: 'success', text: '研究完成' })
    expect(outlineStatusLabel('failed', false)).toMatchObject({ tone: 'danger' })
    expect(outlineStatusLabel('researching', false)).toMatchObject({ spinner: true })
    expect(outlineStatusLabel('editing', true)).toMatchObject({ tone: 'active' })
    expect(outlineStatusLabel('editing', false)).toBeNull()
    expect(confirmButtonLabel('failed')).toBe('重试研究')
    expect(confirmButtonLabel('editing')).toBe('开始研究')
  })
})
