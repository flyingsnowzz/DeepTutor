export type ReaderTheme = 'auto' | 'sepia' | 'night'
export type EpubSpreadMode = 'none' | 'auto'

export interface ReaderDisplayPreferences {
  fontSize: number
  lineWidth: number
  serif: boolean
  readerTheme: ReaderTheme
  spreadMode: EpubSpreadMode
}

export const MIN_FONT_SIZE = 12
export const MAX_FONT_SIZE = 28
export const MIN_LINE_WIDTH = 48
export const DEFAULT_READER_DISPLAY_PREFERENCES: ReaderDisplayPreferences = {
  fontSize: 17,
  lineWidth: 84,
  serif: true,
  readerTheme: 'auto',
  spreadMode: 'none',
}
export const READER_PREFS_KEY = 'dt.reader.textPreferences'

function bounded(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

export function normalizeReaderDisplayPreferences(value: unknown): ReaderDisplayPreferences {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    fontSize: bounded(raw.fontSize, 17, MIN_FONT_SIZE, MAX_FONT_SIZE),
    lineWidth: bounded(raw.lineWidth, 84, MIN_LINE_WIDTH, 104),
    serif: typeof raw.serif === 'boolean' ? raw.serif : true,
    readerTheme: raw.readerTheme === 'sepia' || raw.readerTheme === 'night' ? raw.readerTheme : 'auto',
    spreadMode: raw.spreadMode === 'auto' ? 'auto' : 'none',
  }
}

export function loadReaderDisplayPreferences(): ReaderDisplayPreferences {
  try {
    return normalizeReaderDisplayPreferences(JSON.parse(localStorage.getItem(READER_PREFS_KEY) || '{}'))
  } catch {
    return { ...DEFAULT_READER_DISPLAY_PREFERENCES }
  }
}

export function saveReaderDisplayPreferences(preferences: ReaderDisplayPreferences): void {
  try { localStorage.setItem(READER_PREFS_KEY, JSON.stringify(preferences)) } catch { /* Storage may be blocked. */ }
}

export function nextLineWidth(width: number): number {
  return [48, 64, 84, 104].find(value => value > width) ?? MIN_LINE_WIDTH
}

export function nextReaderTheme(theme: ReaderTheme): ReaderTheme {
  return theme === 'auto' ? 'sepia' : theme === 'sepia' ? 'night' : 'auto'
}
