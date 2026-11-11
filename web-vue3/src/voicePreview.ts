/**
 * Voice preview helpers — TTS audition over POST /api/settings/voice/preview.
 * Port of web/lib/voice-settings.ts timing rules and VoicePreviewPanel error
 * handling. Pure functions are unit-tested; the component owns the fetch.
 */

export const DEFAULT_SPEECH_REQUEST_TIMEOUT = 60
export const MIN_SPEECH_REQUEST_TIMEOUT = 5
export const MAX_SPEECH_REQUEST_TIMEOUT = 600
export const DEFAULT_VOICE_PREVIEW_TEXT = '你好，我是你的学习伙伴。让我们一起探索新的知识。'
export const MAX_PREVIEW_CHARS = 500

export interface TimedModel {
  request_timeout?: number | string
  [key: string]: unknown
}

/** Clamp a model's request_timeout to the supported 5–600s window, default 60. */
export function speechRequestTimeout(model?: TimedModel): number {
  const seconds = Number(model?.request_timeout)
  return Number.isInteger(seconds) &&
    seconds >= MIN_SPEECH_REQUEST_TIMEOUT &&
    seconds <= MAX_SPEECH_REQUEST_TIMEOUT
    ? seconds
    : DEFAULT_SPEECH_REQUEST_TIMEOUT
}

/**
 * Defensive error extraction for a failed preview fetch. A reverse proxy may
 * replace the backend's JSON error with an HTML page, so surface the HTTP
 * status instead of throwing a JSON parse error.
 */
export async function readPreviewError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { detail?: unknown }
  if (typeof payload.detail === 'string' && payload.detail.trim()) {
    return payload.detail
  }
  return `语音预览失败（HTTP ${response.status}）。`
}

/** Validate a synthesis response body is playable audio. */
export function isPlayableAudio(blob: Blob): boolean {
  return blob.size > 0 && blob.type.startsWith('audio/')
}

/** Guard the preview text length and presence. */
export function canPreview(text: string, maxChars = MAX_PREVIEW_CHARS): boolean {
  const trimmed = text.trim()
  return trimmed.length > 0 && trimmed.length <= maxChars
}
