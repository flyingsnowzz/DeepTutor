import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  audioExtType,
  isAudioFileAcceptable,
  isEmptyResult,
  isPreviewService,
  reducePreviewEvent,
  validatePreviewInput,
} from '../servicePreview'

describe('isPreviewService', () => {
  it('accepts the four documented services only', () => {
    expect(isPreviewService('search')).toBe(true)
    expect(isPreviewService('videogen')).toBe(true)
    expect(isPreviewService('tts')).toBe(false)
  })
})

describe('validatePreviewInput', () => {
  it('requires non-empty text within 2000 chars for non-stt services', () => {
    expect(() => validatePreviewInput('search', '', '', '')).toThrow()
    expect(() => validatePreviewInput('imagegen', 'x'.repeat(2001), '', '')).toThrow()
    expect(() => validatePreviewInput('search', 'hello', '', '')).not.toThrow()
  })

  it('validates audio content type and size for stt', () => {
    expect(() => validatePreviewInput('stt', '', '', 'audio/midi')).toThrow()
    expect(() => validatePreviewInput('stt', '', 'A'.repeat(20 * 1024 * 1024), 'audio/wav')).toThrow()
    expect(() => validatePreviewInput('stt', '', 'AAAA', 'audio/wav')).not.toThrow()
    expect(() => validatePreviewInput('stt', '', 'AAAA', 'audio/midi')).toThrow()
  })
})

describe('audio helpers', () => {
  it('maps extensions to MIME and enforces the 8MB cap', () => {
    expect(audioExtType('clip.MP3')).toBe('audio/mpeg')
    expect(audioExtType('clip.xyz')).toBe('')
    const ok = new File(['x'], 'a.wav', { type: 'audio/wav' })
    Object.defineProperty(ok, 'size', { value: 10 })
    expect(isAudioFileAcceptable(ok)).toBe(true)
    const big = new File(['x'], 'a.wav')
    Object.defineProperty(big, 'size', { value: 9 * 1024 * 1024 })
    expect(isAudioFileAcceptable(big)).toBe(false)
  })
})

describe('reducePreviewEvent', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps progress and error events to state and phase', () => {
    expect(reducePreviewEvent({ type: 'progress', phase: 'rendering' })).toMatchObject({
      state: 'running',
      phase: 'rendering',
    })
    expect(reducePreviewEvent({ type: 'error', code: 'timeout' })).toMatchObject({ state: 'timeout' })
    expect(reducePreviewEvent({ type: 'error', code: 'boom' })).toMatchObject({ state: 'failed' })
  })

  it('builds a text result without creating an object URL', () => {
    const out = reducePreviewEvent({ type: 'result', kind: 'transcript', text: '你好' })
    expect(out.state).toBe('success')
    expect(out.result?.text).toBe('你好')
    expect(out.result?.url).toBeUndefined()
  })

  it('decodes base64 media into an object URL for image/video', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    const b64 = btoa('media')
    const out = reducePreviewEvent({
      type: 'result',
      kind: 'image',
      data: b64,
      content_type: 'image/png',
    })
    expect(out.result?.url).toBe('blob:mock')
    expect(create).toHaveBeenCalledOnce()
  })
})

describe('isEmptyResult', () => {
  it('flags empty transcripts and searches but not media', () => {
    expect(isEmptyResult({ kind: 'transcript', text: '  ' })).toBe(true)
    expect(isEmptyResult({ kind: 'search' })).toBe(true)
    expect(isEmptyResult({ kind: 'search', results: [] })).toBe(true)
    expect(isEmptyResult({ kind: 'search', results: [{ title: 't', url: 'u', snippet: 's' }] })).toBe(false)
    expect(isEmptyResult({ kind: 'image' })).toBe(false)
  })
})
