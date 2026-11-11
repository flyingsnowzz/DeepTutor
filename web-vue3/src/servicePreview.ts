/**
 * Service preview helpers — client-side validation and NDJSON stream parsing
 * for POST /api/settings/services/{service}/preview. Port of the rules in
 * deeptutor/services/settings/service_preview.py (validate_input) and the old
 * ServicePreviewPanel reader. Pure functions are unit-tested independently.
 */

export type PreviewService = 'search' | 'stt' | 'imagegen' | 'videogen'
export type PreviewState = 'idle' | 'running' | 'success' | 'failed' | 'timeout' | 'invalidAudio'
export type PreviewPhase = 'requesting' | 'rendering'

export interface PreviewResult {
  kind: 'search' | 'transcript' | 'image' | 'video'
  text?: string
  results?: { title: string; url: string; snippet: string }[]
  url?: string
}

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024
const MAX_TEXT = 2000
const MAX_RESULT_BYTES = 40 * 1024 * 1024

export const AUDIO_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
}

const SERVICES: PreviewService[] = ['search', 'stt', 'imagegen', 'videogen']

export function isPreviewService(value: string): value is PreviewService {
  return (SERVICES as string[]).includes(value)
}

/** Validate preview input before sending; throws with a Chinese message on failure. */
export function validatePreviewInput(
  service: PreviewService,
  text: string,
  audio: string,
  contentType: string,
): void {
  if (service !== 'stt') {
    if (!text.trim() || text.length > MAX_TEXT) {
      throw new Error('请输入 1–2000 个字符的预览内容。')
    }
    return
  }
  if (!Object.values(AUDIO_TYPES).includes(contentType)) {
    throw new Error('请选择 WAV、MP3、M4A、WebM、OGG 或 FLAC 音频文件。')
  }
  if (audio.length > Math.ceil((MAX_AUDIO_BYTES + 2) / 3) * 4) {
    throw new Error('音频样本不能超过 8 MB。')
  }
}

export function audioExtType(filename: string): string {
  const ext = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() ?? '' : ''
  return AUDIO_TYPES[ext] ?? ''
}

export function isAudioFileAcceptable(file: File): boolean {
  return file.size > 0 && file.size <= MAX_AUDIO_BYTES && Boolean(audioExtType(file.name))
}

export interface StreamEvent {
  type: 'progress' | 'error' | 'result' | string
  phase?: string
  code?: string
  kind?: PreviewResult['kind']
  text?: string
  results?: PreviewResult['results']
  data?: string
  content_type?: string
}

/** Reduce one NDJSON preview event into the next UI state/result/phase. */
export function reducePreviewEvent(
  event: StreamEvent,
): { state: PreviewState; phase: PreviewPhase; result?: PreviewResult } {
  if (event.type === 'progress') {
    return { state: 'running', phase: event.phase === 'rendering' ? 'rendering' : 'requesting' }
  }
  if (event.type === 'error') {
    return { state: event.code === 'timeout' ? 'timeout' : 'failed', phase: 'requesting' }
  }
  if (event.type === 'result') {
    const result: PreviewResult = {
      kind: event.kind ?? 'search',
      text: event.text,
      results: event.results,
    }
    if ((event.kind === 'image' || event.kind === 'video') && event.data) {
      const raw = atob(event.data)
      if (raw.length > MAX_RESULT_BYTES) {
        return { state: 'failed', phase: 'requesting' }
      }
      const bytes = Uint8Array.from(raw, char => char.charCodeAt(0))
      result.url = URL.createObjectURL(new Blob([bytes], { type: event.content_type }))
    }
    return { state: 'success', phase: 'requesting', result }
  }
  return { state: 'running', phase: 'requesting' }
}

/** A search/transcript result with no usable payload is considered empty. */
export function isEmptyResult(result: PreviewResult): boolean {
  if (result.kind === 'transcript') return !result.text?.trim()
  if (result.kind === 'search') return !result.text && !(result.results?.length)
  return false
}
