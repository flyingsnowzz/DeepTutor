/**
 * Fenced code block extraction — zero-dependency parser that splits markdown
 * into prose segments and ```fenced``` code blocks. This is the structural
 * foundation for rich block rendering (mermaid diagrams, geoGebra, etc.) and
 * mirrors how the old client special-cases fence languages before rendering.
 */

export interface FencedBlock {
  /** Original lower-cased info string language, '' when unspecified. */
  lang: string
  /** Raw code content with surrounding fence and trailing newline removed. */
  code: string
  /** Whether this is a diagram language the client can render specially. */
  isDiagram: boolean
}

export interface MarkdownSegment {
  type: 'prose' | 'code'
  /** Prose text for prose segments; '' for code segments. */
  text: string
  /** Populated only for code segments. */
  block?: FencedBlock
}

const DIAGRAM_LANGS = new Set(['mermaid', 'geogebra', 'geoebbra', 'plantuml', 'puml'])

const FENCE_RE = /^(\s*)(`{3,}|~{3,})\s*([^\s`~]*)/

/** Parse an info string's language token, lower-cased and trimmed. */
export function parseFenceLang(infoString: string): string {
  return (infoString || '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

export function isDiagramLang(lang: string): boolean {
  return DIAGRAM_LANGS.has(lang.toLowerCase())
}

/**
 * Split markdown into ordered prose/code segments. An unterminated fence is
 * treated as a code block running to end-of-input (lenient, matching common
 * markdown renderers rather than dropping the content).
 */
export function parseMarkdownFences(markdown: string): MarkdownSegment[] {
  const lines = markdown.split('\n')
  const segments: MarkdownSegment[] = []
  let prose: string[] = []
  let inFence = false
  let fenceMarker = ''
  let fenceLang = ''
  let code: string[] = []

  const flushProse = () => {
    if (prose.length) {
      segments.push({ type: 'prose', text: prose.join('\n') })
      prose = []
    }
  }

  for (const line of lines) {
    if (!inFence) {
      const match = line.match(FENCE_RE)
      if (match) {
        flushProse()
        inFence = true
        fenceMarker = match[2]
        fenceLang = parseFenceLang(match[3] ?? '')
        code = []
        continue
      }
      prose.push(line)
      continue
    }

    // Inside a fence: a closing line uses the same fence character with at
    // least as many markers and no info string.
    const trimmed = line.trim()
    if (trimmed.startsWith(fenceMarker[0]) && trimmed.replace(/[`~]/g, '').trim() === '' && trimmed.length >= fenceMarker.length) {
      const block: FencedBlock = { lang: fenceLang, code: code.join('\n'), isDiagram: isDiagramLang(fenceLang) }
      segments.push({ type: 'code', text: '', block })
      inFence = false
      fenceMarker = ''
      fenceLang = ''
      code = []
      continue
    }
    code.push(line)
  }

  if (inFence) {
    // Lenient: keep the unterminated block instead of silently losing it.
    const block: FencedBlock = { lang: fenceLang, code: code.join('\n'), isDiagram: isDiagramLang(fenceLang) }
    segments.push({ type: 'code', text: '', block })
  }
  flushProse()
  return segments
}

/** Convenience: return only diagram blocks in document order. */
export function extractDiagramBlocks(markdown: string): FencedBlock[] {
  return parseMarkdownFences(markdown)
    .filter(segment => segment.type === 'code' && segment.block?.isDiagram)
    .map(segment => segment.block as FencedBlock)
}
