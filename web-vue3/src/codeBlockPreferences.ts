import { reactive } from 'vue'
import { api } from './api'

interface Preferences { theme: string; showLineNumbers: boolean; wrapLongLines: boolean }
export const codeBlockPreferences = reactive<Preferences>({ theme: 'oneDark', showLineNumbers: true, wrapLongLines: false })
let inflight: Promise<void> | null = null

export function loadCodeBlockPreferences(force = false): Promise<void> {
  if (inflight && !force) return inflight
  inflight = api<{ ui?: { code_block_theme?: string; code_block_show_line_numbers?: boolean; code_block_wrap_long_lines?: boolean } }>('/api/settings')
    .then(result => {
      codeBlockPreferences.theme = result.ui?.code_block_theme || 'oneDark'
      codeBlockPreferences.showLineNumbers = result.ui?.code_block_show_line_numbers ?? true
      codeBlockPreferences.wrapLongLines = result.ui?.code_block_wrap_long_lines ?? false
    })
    .catch(() => { /* Markdown remains readable if settings are unavailable. */ })
  return inflight
}

export function setCodeBlockPreferences(value: Partial<Preferences>) { Object.assign(codeBlockPreferences, value) }
