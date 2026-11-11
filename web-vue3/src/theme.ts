export type Theme = 'light' | 'dark' | 'glass' | 'snow'

export const THEME_STORAGE_KEY = 'deeptutor-theme'

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'glass' || value === 'snow'
}

export function getStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(value) ? value : null
  } catch {
    return null
  }
}

export function saveThemeToStorage(theme: Theme): boolean {
  if (typeof window === 'undefined') return false
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
    return true
  } catch {
    return false
  }
}

export function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'snow'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'snow'
}

export function applyThemeToDocument(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.remove('dark', 'theme-glass', 'theme-snow')
  document.documentElement.dataset.theme = theme
  if (theme === 'dark') document.documentElement.classList.add('dark')
  else if (theme === 'glass') document.documentElement.classList.add('dark', 'theme-glass')
  else if (theme === 'snow') document.documentElement.classList.add('theme-snow')
}

export function initializeTheme(): Theme {
  const theme = getStoredTheme() ?? getSystemTheme()
  applyThemeToDocument(theme)
  saveThemeToStorage(theme)
  return theme
}

export function setTheme(theme: Theme): void {
  applyThemeToDocument(theme)
  saveThemeToStorage(theme)
}
