import { describe, expect, it } from 'vitest'
import {
  parseChartConfig,
  prepareIframeHtml,
  sanitizeSvg,
  splitSvgBlocks,
  stripCodeFence,
} from '../visualizeRendering'

describe('visualize rendering helpers', () => {
  it('strips JSON/JS fences and repairs common JS-object syntax', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(parseChartConfig("{type:'bar',data:{labels:['A',],},}")).toEqual({
      type: 'bar',
      data: { labels: ['A'] },
    })
  })

  it('splits concatenated SVG blocks and scopes ids', () => {
    const blocks = splitSvgBlocks('<svg id="a"></svg><svg id="b"></svg>')
    expect(blocks).toHaveLength(2)
    const safe = sanitizeSvg('<svg id="marker"><defs><marker id="arrow"/></defs><path marker-end="url(#arrow)" onclick="x()"/></svg>')
    expect(safe).toContain('id="dtsvg')
    expect(safe).toContain('url(#dtsvg')
    expect(safe).not.toContain('onclick')
  })

  it('removes scripts, embedded HTML and javascript urls from SVG', () => {
    const safe = sanitizeSvg('<svg><script>alert(1)</script><foreignObject><div/></foreignObject><a href="javascript:bad()"/><rect id="x"/></svg>')
    expect(safe).not.toContain('<script')
    expect(safe).not.toContain('foreignObject')
    expect(safe).not.toContain('javascript:')
    expect(safe).toContain('<rect')
  })

  it('rejects malformed or non-svg documents', () => {
    expect(sanitizeSvg('<div/>')).toBe('')
    expect(sanitizeSvg('<svg><g></svg>')).toBe('')
  })

  it('prepares sandboxed HTML with KaTeX and the postMessage bridge', () => {
    const prepared = prepareIframeHtml('<html><head></head><body><a href="javascript:x" target="_top">x</a></body></html>')
    expect(prepared).toContain('katex')
    expect(prepared).toContain('dt:visualize-height')
    expect(prepared).not.toContain('javascript:x')
    expect(prepared).toContain('target="_self"')
  })
})
