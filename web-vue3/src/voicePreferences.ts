import { api } from './api'

export interface VoicePreferences { autoplay: boolean; mathSpeak: boolean }
let cached: VoicePreferences | null = null
let inflight: Promise<VoicePreferences> | null = null
export async function loadVoicePreferences(force = false): Promise<VoicePreferences> {
  if (cached && !force) return cached
  if (!inflight) inflight = api<{ ui?: { voice_autoplay?: boolean; voice_math_speak?: boolean } }>('/api/settings').then(result => {
    cached = { autoplay: result.ui?.voice_autoplay === true, mathSpeak: result.ui?.voice_math_speak !== false }
    return cached
  }).catch(() => ({ autoplay: false, mathSpeak: true })).finally(() => { inflight = null })
  return inflight
}
export async function setVoiceAutoplay(next: boolean): Promise<void> {
  const previous = cached
  cached = { autoplay: next, mathSpeak: cached?.mathSpeak ?? true }
  window.dispatchEvent(new CustomEvent('deeptutor:voice-autoplay-global', { detail: { value: next } }))
  try { await api('/api/settings/voice-autoplay', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice_autoplay: next }) }) }
  catch (cause) { cached = previous; throw cause }
}
export async function setVoiceMathSpeak(next: boolean): Promise<void> {
  const previous = cached
  cached = { autoplay: cached?.autoplay ?? false, mathSpeak: next }
  window.dispatchEvent(new CustomEvent('deeptutor:voice-math-speak', { detail: { value: next } }))
  try { await api('/api/settings/voice-math-speak', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice_math_speak: next }) }) }
  catch (cause) { cached = previous; throw cause }
}
