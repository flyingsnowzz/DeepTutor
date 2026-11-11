export type SlashCommand = 'persona' | 'language'

export interface ResponseLanguageOption {
  value: string
  label: string
}

export const RESPONSE_LANGUAGE_OPTIONS: readonly ResponseLanguageOption[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '简体中文' },
  { value: 'zh-tw', label: '繁體中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'ru', label: 'Русский' },
  { value: 'pt', label: 'Português' },
  { value: 'it', label: 'Italiano' },
  { value: 'ar', label: 'العربية' },
  { value: 'pl', label: 'Polski' },
  { value: 'uk', label: 'Українська' },
  { value: 'ms', label: 'Bahasa Melayu' },
]

export function isResponseLanguage(value: unknown): value is string {
  return typeof value === 'string' && RESPONSE_LANGUAGE_OPTIONS.some(option => option.value === value)
}

/** Slash commands only match at the start of the composer, as in the legacy app. */
export function matchingSlashCommands(
  value: string,
  enabled: readonly SlashCommand[] = ['persona', 'language'],
): SlashCommand[] {
  const match = /^\/([a-z]*)$/i.exec(value)
  if (!match) return []
  const query = match[1].toLowerCase()
  return enabled.filter(command => command.startsWith(query))
}
