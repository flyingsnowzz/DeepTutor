import { describe, expect, it } from 'vitest'
import {
  extractGeogebraRender,
  extractVisualizeResult,
  isManimResult,
  isManimRenderType,
  nativeRenderer,
} from '../visualizeResult'

describe('nativeRenderer', () => {
  it('prefers renderer.native_renderer then render_type', () => {
    expect(nativeRenderer({ render_type: 'geogebra', renderer: { native_renderer: 'svg' } })).toBe('svg')
    expect(nativeRenderer({ render_type: 'geogebra' })).toBe('geogebra')
    expect(nativeRenderer({})).toBe('')
  })
})

describe('extractGeogebraRender', () => {
  it('returns null for non-geogebra or missing metadata', () => {
    expect(extractGeogebraRender(undefined)).toBeNull()
    expect(extractGeogebraRender({ render_type: 'mermaid' })).toBeNull()
  })
  it('uses payload.data when it carries a commands array', () => {
    const r = extractGeogebraRender({
      render_type: 'geogebra',
      payload: { data: { app_name: 'geometry', commands: ['A=(1,2)', ''], show_axes: true } },
      code: { content: 'fallback script' },
      presentation: { title: '圆' },
    })
    expect(r?.title).toBe('圆')
    expect(r?.script).toBe('')
    expect(r?.payload?.commands).toEqual(['A=(1,2)'])
    expect(r?.payload?.show_axes).toBe(true)
  })
  it('falls back to code.content script when payload has no commands', () => {
    const r = extractGeogebraRender({
      render_type: 'geogebra',
      payload: { data: { not: 'commands' } },
      code: { content: 'A=(1,2)\nB=(3,4)' },
    })
    expect(r?.payload).toBeUndefined()
    expect(r?.script).toBe('A=(1,2)\nB=(3,4)')
  })
})

describe('extractVisualizeResult', () => {
  it('parses a chart canvas envelope and prefers payload.data', () => {
    const result = extractVisualizeResult({
      render_type: 'chartjs',
      schema_version: 'v1',
      payload: { format: 'application/json', data: { type: 'bar', data: { labels: ['A'] } } },
      code: { language: 'javascript', content: 'fallback' },
      presentation: { title: 'Sales' },
      analysis: { chart_type: 'bar', description: 'Bars' },
      renderer: { id: 'chartjs', native_renderer: 'chartjs' },
    })
    expect(result?.render_type).toBe('chartjs')
    if (!result || isManimResult(result)) throw new Error('expected canvas result')
    expect(result.renderer.native_renderer).toBe('chartjs')
    expect(result.presentation.title).toBe('Sales')
    expect(result.code.content).toContain('"labels"')
  })

  it('infers mindmap as the mermaid renderer and keeps code fallback', () => {
    const result = extractVisualizeResult({
      render_type: 'mindmap',
      code: { language: 'mermaid', content: 'mindmap\n  root' },
    })
    if (!result || isManimResult(result)) throw new Error('expected canvas result')
    expect(result.renderer.native_renderer).toBe('mermaid')
    expect(result.code.content).toBe('mindmap\n  root')
  })

  it('parses manim envelopes and rejects non-manim render metadata', () => {
    const result = extractVisualizeResult({
      render_type: 'manim_video',
      output_mode: 'video',
      artifacts: [{ type: 'video', url: '/files/a.mp4', filename: 'a.mp4' }],
    })
    expect(result && isManimResult(result)).toBe(true)
    expect(extractVisualizeResult({ render_type: 'manim_video', response: 'nothing' })).toBeNull()
    expect(isManimRenderType('manim_image')).toBe(true)
  })

  it('rejects envelopes with no render type or empty content', () => {
    expect(extractVisualizeResult(undefined)).toBeNull()
    expect(extractVisualizeResult({ render_type: '' })).toBeNull()
    expect(extractVisualizeResult({ render_type: 'svg', code: { content: ' ' } })).toBeNull()
  })
})
