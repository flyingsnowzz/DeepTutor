import { describe, expect, it } from 'vitest'
import {
  extractDiagramBlocks,
  isDiagramLang,
  parseFenceLang,
  parseMarkdownFences,
} from '../markdownFences'

describe('parseFenceLang', () => {
  it('takes the first token and lower-cases it', () => {
    expect(parseFenceLang('Mermaid')).toBe('mermaid')
    expect(parseFenceLang('tsx title="x"')).toBe('tsx')
    expect(parseFenceLang('   ')).toBe('')
  })
})

describe('isDiagramLang', () => {
  it('recognizes diagram languages case-insensitively', () => {
    expect(isDiagramLang('mermaid')).toBe(true)
    expect(isDiagramLang('GeoGebra')).toBe(true)
    expect(isDiagramLang('plantuml')).toBe(true)
    expect(isDiagramLang('python')).toBe(false)
  })
})

describe('parseMarkdownFences', () => {
  it('returns a single prose segment when there are no fences', () => {
    const segments = parseMarkdownFences('hello\nworld')
    expect(segments).toEqual([{ type: 'prose', text: 'hello\nworld' }])
  })

  it('splits prose around a fenced code block and strips the fence', () => {
    const md = 'before\n```python\nprint(1)\n```\nafter'
    const segments = parseMarkdownFences(md)
    expect(segments.map(s => s.type)).toEqual(['prose', 'code', 'prose'])
    expect(segments[0].text).toBe('before')
    expect(segments[1].block).toMatchObject({ lang: 'python', code: 'print(1)', isDiagram: false })
    expect(segments[2].text).toBe('after')
  })

  it('flags diagram fences and preserves multi-line code', () => {
    const md = '```mermaid\ngraph TD;\n  A-->B;\n```'
    const block = parseMarkdownFences(md)[0].block
    expect(block).toMatchObject({ lang: 'mermaid', isDiagram: true })
    expect(block?.code).toBe('graph TD;\n  A-->B;')
  })

  it('supports tilde fences and fences with leading indentation', () => {
    const md = '  ~~~json\n{"a":1}\n  ~~~'
    const block = parseMarkdownFences(md)[0].block
    expect(block?.lang).toBe('json')
    expect(block?.code).toBe('{"a":1}')
  })

  it('keeps an unterminated fence as a lenient code block', () => {
    const segments = parseMarkdownFences('intro\n```js\nconst x = 1')
    expect(segments.map(s => s.type)).toEqual(['prose', 'code'])
    expect(segments[1].block?.code).toBe('const x = 1')
  })

  it('does not treat inline backticks as a fence', () => {
    const segments = parseMarkdownFences('use `code` inline')
    expect(segments).toHaveLength(1)
    expect(segments[0].type).toBe('prose')
  })
})

describe('extractDiagramBlocks', () => {
  it('returns only diagram blocks in order', () => {
    const md = '```python\n1\n```\n```mermaid\nA-->B\n```\n```plantuml\n@startuml\n```'
    const blocks = extractDiagramBlocks(md)
    expect(blocks.map(b => b.lang)).toEqual(['mermaid', 'plantuml'])
  })
})
