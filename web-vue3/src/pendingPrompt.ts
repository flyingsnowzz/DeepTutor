const key = 'deeptutor.pendingPrompt.mastery_opening'

export function setMasteryOpeningPrompt(text: string): void {
  try { sessionStorage.setItem(key, text) } catch { /* The destination still opens when storage is unavailable. */ }
}

export function consumeMasteryOpeningPrompt(): string {
  try {
    const value = sessionStorage.getItem(key) || ''
    if (value) sessionStorage.removeItem(key)
    return value
  } catch { return '' }
}
