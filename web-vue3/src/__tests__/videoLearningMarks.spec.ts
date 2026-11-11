import { describe, expect, it } from 'vitest'
import {
  cuesToSegmentLocators,
  filterMarks,
  formatMarkRange,
  formatMarkTime,
  locatorsForRange,
  markCoversTime,
  rangeFromCues,
  uniqueSortedIndexes,
  VIDEO_MARK_COLORS,
} from '../videoLearningMarks'
import type { VideoLearningMark } from '../videoLearning'

const cues = [
  { start: 0, end: 5, text: 'A' },
  { start: 5, end: 10, text: 'B' },
  { start: 10, end: 15, text: 'C' },
]

const mark: VideoLearningMark = {
  mark_id: 'm1',
  kind: 'key_point',
  start_seconds: 5,
  end_seconds: 10,
  start_locator: 2,
  end_locator: 2,
  quote: 'B',
  note: '',
  author: 'user',
  created_at: '',
  updated_at: '',
}

describe('video learning marks', () => {
  it('normalizes cue selections and builds time/text ranges', () => {
    expect(uniqueSortedIndexes([2, 0, 2, -1])).toEqual([0, 2])
    expect(rangeFromCues(cues, [0, 1])).toEqual({
      start_seconds: 0,
      end_seconds: 10,
      quote: 'A B',
    })
    expect(cuesToSegmentLocators([0, 1], cues)).toEqual({ start_locator: 1, end_locator: 3 })
    expect(locatorsForRange(cues.map((cue, index) => ({ ...cue, locator: index + 1 })), 6, 11)).toEqual({
      start_locator: 2,
      end_locator: 3,
    })
  })

  it('filters, sorts and tests time coverage', () => {
    const second: VideoLearningMark = { ...mark, mark_id: 'm2', kind: 'question', start_seconds: 12, end_seconds: 12 }
    expect(filterMarks([second, mark], 'question')).toEqual([second])
    expect(filterMarks([second, mark], 'all')[0]?.mark_id).toBe('m1')
    expect(markCoversTime(mark, 7)).toBe(true)
    expect(markCoversTime(second, 12)).toBe(true)
    expect(markCoversTime(second, 14)).toBe(false)
  })

  it('formats timestamps and exposes stable colors', () => {
    expect(formatMarkTime(75)).toBe('01:15')
    expect(formatMarkTime(3725)).toBe('1:02:05')
    expect(formatMarkRange(mark)).toBe('00:05 - 00:10')
    expect(Object.keys(VIDEO_MARK_COLORS)).toHaveLength(3)
  })
})
