/**
 * Decode dense \uXXXX runs that represent non-ASCII text. Vue3 port of the
 * #973-family helpers in web/lib/markdown-display.ts, scoped to the contract
 * the quiz pipeline needs: protect fenced code, math and inline code spans,
 * then repair escaped non-ASCII runs outside those spans.
 */

const FENCED_CODE_BLOCK_REGEX = /```[\s\S]*?```/g
const INLINE_CODE_SPAN_REGEX = /`[^`\n]*`/g
const MATH_SPAN_REGEX =
  /\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$(?!\s)(?:\\.|[^$\n])*?(?<!\s)\$/g
const ESCAPED_UNICODE_RUN_REGEX = /(?:\\u[0-9a-fA-F]{4}){3,}/g
const INDENTED_CODE_LINE_REGEX = /^(?: {4}|\t)/

interface MaskedText {
  masked: string
  restore: (value: string) => string
}

function maskProtectedSpans(content: string, regex: RegExp, label: string): MaskedText {
  const protectedSpans: string[] = []
  const masked = content.replace(regex, (match) => {
    protectedSpans.push(match)
    return `\u0000${label}_${protectedSpans.length - 1}\u0000`
  })
  const placeholderRegex = new RegExp(`\\u0000${label}_(\\d+)\\u0000`, 'g')
  return {
    masked,
    restore: (value: string) =>
      value.replace(placeholderRegex, (_match, idx: string) => protectedSpans[Number(idx)] ?? ''),
  }
}

function decodeEscapedUnicodeRun(escaped: string): string {
  try {
    const value = JSON.parse(`"${escaped}"`) as string
    const containsNonAscii = Array.from(value).some(
      (character) => character.charCodeAt(0) > 0x7f,
    )
    return containsNonAscii ? value : escaped
  } catch {
    return escaped
  }
}

/** Decode escaped unicode runs while leaving code/math spans untouched. */
export function decodeEscapedUnicodeForDisplay(content: string): string {
  if (!content) return ''
  const fenced = maskProtectedSpans(String(content), FENCED_CODE_BLOCK_REGEX, 'UNICODE_FENCED_CODE')
  const math = maskProtectedSpans(fenced.masked, MATH_SPAN_REGEX, 'UNICODE_MATH')
  const inline = maskProtectedSpans(math.masked, INLINE_CODE_SPAN_REGEX, 'UNICODE_INLINE_CODE')
  const decoded = inline.masked
    .split('\n')
    .map((line) =>
      INDENTED_CODE_LINE_REGEX.test(line)
        ? line
        : line.replace(ESCAPED_UNICODE_RUN_REGEX, decodeEscapedUnicodeRun),
    )
    .join('\n')
  return fenced.restore(math.restore(inline.restore(decoded)))
}
