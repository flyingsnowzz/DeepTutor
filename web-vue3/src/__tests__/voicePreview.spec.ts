import { describe, expect, it } from 'vitest'
import {
  canPreview,
  isPlayableAudio,
  MAX_PREVIEW_CHARS,
  readPreviewError,
  speechRequestTimeout,
} from '../voicePreview'

describe('speechRequestTimeout', () => {
  it('uses the model timeout within the 5–600s window', () => {
    expect(speechRequestTimeout({ request_timeout: 30 })).toBe(30)
    expect(speechRequestTimeout({ request_timeout: '45' })).toBe(45)
  })

  it('falls back to 60s for missing, out-of-range, or non-integer values', () => {
    expect(speechRequestTimeout()).toBe(60)
    expect(speechRequestTimeout({ request_timeout: 2 })).toBe(60)
    expect(speechRequestTimeout({ request_timeout: 9999 })).toBe(60)
    expect(speechRequestTimeout({ request_timeout: 12.5 })).toBe(60)
    expect(speechRequestTimeout({ request_timeout: 'abc' })).toBe(60)
  })
})

describe('canPreview', () => {
  it('requires non-empty text within the char cap', () => {
    expect(canPreview('你好')).toBe(true)
    expect(canPreview('   ')).toBe(false)
    expect(canPreview('')).toBe(false)
    expect(canPreview('x'.repeat(MAX_PREVIEW_CHARS))).toBe(true)
    expect(canPreview('x'.repeat(MAX_PREVIEW_CHARS + 1))).toBe(false)
  })
})

describe('isPlayableAudio', () => {
  it('requires a non-empty audio blob', () => {
    expect(isPlayableAudio(new Blob(['x'], { type: 'audio/mpeg' }))).toBe(true)
    expect(isPlayableAudio(new Blob([], { type: 'audio/mpeg' }))).toBe(false)
    expect(isPlayableAudio(new Blob(['x'], { type: 'application/json' }))).toBe(false)
  })
})

describe('readPreviewError', () => {
  it('returns the backend detail when present', async () => {
    const res = new Response(JSON.stringify({ detail: '额度不足' }), { status: 502 })
    expect(await readPreviewError(res)).toBe('额度不足')
  })

  it('falls back to an HTTP message for non-JSON or missing detail', async () => {
    const html = new Response('<html>502 Bad Gateway</html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    })
    expect(await readPreviewError(html)).toBe('语音预览失败（HTTP 502）。')
    const empty = new Response(JSON.stringify({}), { status: 400 })
    expect(await readPreviewError(empty)).toBe('语音预览失败（HTTP 400）。')
  })
})
