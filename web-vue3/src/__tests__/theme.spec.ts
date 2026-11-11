import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyThemeToDocument,
  getStoredTheme,
  initializeTheme,
  isTheme,
  setTheme,
  THEME_STORAGE_KEY,
} from '../theme'

describe('theme preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ''
    delete document.documentElement.dataset.theme
  })

  it('validates supported themes and reads the stored preference', () => {
    expect(isTheme('glass')).toBe(true)
    expect(isTheme('purple')).toBe(false)
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    expect(getStoredTheme()).toBe('dark')
  })

  it('applies the same document classes as the legacy client', () => {
    applyThemeToDocument('light')
    expect(document.documentElement.className).toBe('')
    expect(document.documentElement.dataset.theme).toBe('light')

    applyThemeToDocument('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    applyThemeToDocument('glass')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('theme-glass')).toBe(true)

    applyThemeToDocument('snow')
    expect(document.documentElement.classList.contains('theme-snow')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('initializes and persists a chosen theme', () => {
    expect(initializeTheme()).toBe('snow')
    expect(getStoredTheme()).toBe('snow')
    setTheme('glass')
    expect(getStoredTheme()).toBe('glass')
    expect(document.documentElement.classList.contains('theme-glass')).toBe(true)
  })
})
