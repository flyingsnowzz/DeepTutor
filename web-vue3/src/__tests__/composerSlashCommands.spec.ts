import { describe, expect, it } from 'vitest'
import { matchingSlashCommands, RESPONSE_LANGUAGE_OPTIONS } from '../composerSlashCommands'

describe('composer slash commands', () => {
  it('matches both commands only at the start and filters by prefix', () => {
    expect(matchingSlashCommands('/')).toEqual(['persona', 'language'])
    expect(matchingSlashCommands('/per')).toEqual(['persona'])
    expect(matchingSlashCommands('/LAN')).toEqual(['language'])
    expect(matchingSlashCommands('Please /language')).toEqual([])
    expect(matchingSlashCommands('/language extra')).toEqual([])
  })

  it('keeps the same 15 response languages as the legacy settings catalog', () => {
    expect(RESPONSE_LANGUAGE_OPTIONS.map(option => option.value)).toEqual([
      'en', 'zh', 'zh-tw', 'ja', 'ko', 'es', 'fr', 'de', 'ru', 'pt', 'it', 'ar', 'pl', 'uk', 'ms',
    ])
  })
})
