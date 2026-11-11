import { describe, expect, it } from 'vitest'
import {
  activePracticePoint,
  nextReviewDue,
  practiceChartGeometry,
  practiceMarkdown,
  practiceRefsFromQuery,
  practiceReviewProgress,
  scheduledLaterCount,
  type PracticeDailyCounts,
} from '../practice'

const rows: PracticeDailyCounts[] = [
  { date: '2026-11-09', questions: 1, mistakes: 0, reviews: 2 },
  { date: '2026-11-10', questions: 4, mistakes: 2, reviews: 3 },
  { date: '2026-11-11', questions: 2, mistakes: 1, reviews: 6 },
]

describe('practice helpers', () => {
  it('parses collection and legacy question deep links with one workspace', () => {
    expect(
      practiceRefsFromQuery({ questions: '4,7,4,bad,-1', dt_workspace: 'class-a' }),
    ).toEqual([
      { id: 4, workspaceId: 'class-a' },
      { id: 7, workspaceId: 'class-a' },
    ])
    expect(practiceRefsFromQuery({ question: '9', workspace: 'class-b' })).toEqual([
      { id: 9, workspaceId: 'class-b' },
    ])
    expect(practiceRefsFromQuery({ questions: ['2,3'] })).toEqual([{ id: 2 }, { id: 3 }])
    expect(practiceRefsFromQuery({})).toEqual([])
  })

  it('normalizes generated markdown fences', () => {
    expect(practiceMarkdown('Question?```python\nx = 1\n```')).toBe(
      'Question?\n\n```python\nx = 1\n```',
    )
    expect(practiceMarkdown('Inline `x`\n\n```ts\nconst x = 1\n```')).toBe(
      'Inline `x`\n\n```ts\nconst x = 1\n```',
    )
  })

  it('tracks due dates and requeues failed reviews without counting them as saved', () => {
    expect(nextReviewDue(null, 100)).toBe(100)
    expect(nextReviewDue(100, 80)).toBe(80)
    expect(nextReviewDue(80, Number.NaN)).toBe(80)
    expect(scheduledLaterCount({ total: 8, due: 3 } as never)).toBe(5)

    const current = { id: 4, workspaceId: 'class-a' }
    expect(
      practiceReviewProgress([current], current, 0, null, 'again', { due_at: 200 }),
    ).toEqual({ queue: [current, current], saved: 0, nextDue: 200 })
    expect(
      practiceReviewProgress([current], current, 2, 300, 'good', { due_at: 200 }),
    ).toEqual({ queue: [current], saved: 3, nextDue: 200 })
  })

  it('derives a bounded chart and picks the active date', () => {
    const geometry = practiceChartGeometry(rows, 'reviews', 600)
    expect(geometry.top).toBe(6)
    expect(geometry.ticks).toEqual([0, 3, 6])
    expect(geometry.points.map(point => point.value)).toEqual([2, 3, 6])
    expect(geometry.points[0]!.y).toBeGreaterThan(geometry.points[2]!.y)
    expect(geometry.linePath.startsWith('M')).toBe(true)
    expect(activePracticePoint(rows, 'reviews', geometry, '2026-11-10')).toMatchObject({
      index: 1,
      row: { reviews: 3 },
      point: { value: 3 },
    })
    expect(activePracticePoint(rows, 'reviews', geometry, 'missing').index).toBe(2)
  })
})
