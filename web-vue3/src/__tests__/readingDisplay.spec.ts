import { describe, expect, it } from 'vitest'
import {
  DEFAULT_READER_DISPLAY_PREFERENCES,
  nextLineWidth,
  nextReaderTheme,
  normalizeReaderDisplayPreferences,
} from '../readingDisplay'

describe('reader display preferences', () => {
  it('clamps persisted numeric values and normalizes enums', () => {
    expect(normalizeReaderDisplayPreferences({ fontSize: 100, lineWidth: 1, readerTheme: 'night', spreadMode: 'auto', serif: false })).toEqual({
      fontSize: 28,
      lineWidth: 48,
      readerTheme: 'night',
      spreadMode: 'auto',
      serif: false,
    })
    expect(normalizeReaderDisplayPreferences(null)).toEqual(DEFAULT_READER_DISPLAY_PREFERENCES)
  })

  it('cycles themes and line-width steps', () => {
    expect(nextReaderTheme('auto')).toBe('sepia')
    expect(nextReaderTheme('sepia')).toBe('night')
    expect(nextReaderTheme('night')).toBe('auto')
    expect(nextLineWidth(48)).toBe(64)
    expect(nextLineWidth(104)).toBe(48)
  })
})
