import { describe, expect, it, vi } from 'vitest'
import { applySetupUiSettings, refreshSetupUi } from '../setupSync'

describe('setup UI synchronization', () => {
  it('applies valid setup theme and language preferences', () => {
    expect(
      applySetupUiSettings({ theme: 'glass', language: 'zh', response_language: 'zh-tw' }),
    ).toBe('glass')
    expect(document.documentElement.classList.contains('theme-glass')).toBe(true)
    expect(localStorage.getItem('deeptutor-language')).toBe('zh')
    expect(localStorage.getItem('deeptutor-response-language')).toBe('zh-tw')
    expect(applySetupUiSettings({ theme: 'invalid' })).toBeNull()
  })

  it('refreshes UI settings from the server', async () => {
    const request = vi.fn().mockResolvedValue({ theme: 'dark' })
    expect(await refreshSetupUi(request)).toBe('dark')
    expect(request).toHaveBeenCalledOnce()
  })
})
