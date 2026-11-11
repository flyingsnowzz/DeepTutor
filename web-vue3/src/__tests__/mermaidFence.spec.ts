import { describe, expect, it } from 'vitest'
import { extractDiagramBlocks, isDiagramLang, parseMarkdownFences } from '../markdownFences'

describe('mermaid fence detection', () => {
  it('flags mermaid language as a diagram', () => {
    expect(isDiagramLang('mermaid')).toBe(true)
    expect(isDiagramLang('MERMAID')).toBe(true)
    expect(isDiagramLang('python')).toBe(false)
  })

  it('parses a mermaid fence into a diagram block', () => {
    const md = '# Title\n\n```mermaid\ngraph TD;\n  A-->B;\n```\n'
    const segments = parseMarkdownFences(md)
    const code = segments.filter(s => s.type === 'code')
    expect(code).toHaveLength(1)
    const first = code[0]
    if (first && first.type === 'code' && first.block) {
      expect(first.block.lang).toBe('mermaid')
      expect(first.block.isDiagram).toBe(true)
      expect(first.block.code).toContain('A-->B')
    } else {
      throw new Error('expected a code segment with a block')
    }
  })

  it('extracts only diagram blocks for rendering', () => {
    const md = [
      '```mermaid',
      'graph TD; A-->B;',
      '```',
      '```python',
      'print(1)',
      '```',
    ].join('\n')
    const diagrams = extractDiagramBlocks(md)
    expect(diagrams).toHaveLength(1)
    expect(diagrams[0].lang).toBe('mermaid')
  })
})
