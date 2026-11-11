import { describe, expect, it } from 'vitest'
import { cleanQuote, mergeRectsByLine, normaliseRects, unionRect } from '../readingSelection'

describe('reading selection geometry', () => {
  it('merges sliver and line rectangles, then normalizes and clamps them', () => {
    const merged = mergeRectsByLine([
      { left: 0, top: 0, width: 20, height: 10 },
      { left: 25, top: 1, width: 30, height: 9 },
      { left: 0, top: 30, width: 40, height: 12 },
      { left: 1, top: 0, width: 1, height: 1 },
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ left: 0, top: 0, width: 55, height: 10 })
    const normalized = normaliseRects(
      [{ left: 10, top: 20, width: 50, height: 40 }, { left: -20, top: 130, width: 10, height: 10 }],
      { left: 10, top: 20, width: 100, height: 100 },
    )
    expect(normalized).toEqual([[0, 0, 0.5, 0.4]])
  })

  it('unions normalized rects and flattens hard line breaks in quotes', () => {
    expect(unionRect([[0.1, 0.2, 0.3, 0.4], [0.2, 0.4, 0.7, 0.9]])).toEqual([0.1, 0.2, 0.7, 0.9])
    expect(cleanQuote('first\nsecond   third')).toBe('first second third')
  })
})
