import { api } from './api'
import { isTheme, setTheme, type Theme } from './theme'

export interface SetupUiSettings {
  theme?: unknown
  language?: unknown
  response_language?: unknown
}

/** Apply the assistant's successful setup writes through the normal theme path. */
export function applySetupUiSettings(payload: SetupUiSettings): Theme | null {
  if (!isTheme(payload.theme)) return null
  setTheme(payload.theme)
  if (typeof payload.language === 'string') {
    try { localStorage.setItem('deeptutor-language', payload.language) } catch { /* optional */ }
  }
  if (typeof payload.response_language === 'string') {
    try { localStorage.setItem('deeptutor-response-language', payload.response_language) } catch { /* optional */ }
  }
  return payload.theme
}

export async function refreshSetupUi(
  request: () => Promise<SetupUiSettings> = () => api<SetupUiSettings>('/api/settings/ui'),
): Promise<Theme | null> {
  return applySetupUiSettings(await request())
}
