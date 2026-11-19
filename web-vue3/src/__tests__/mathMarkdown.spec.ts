import { describe, expect, it } from 'vitest'
import { renderInlineMarkdown, renderMarkdownProse } from '../mathMarkdown'

describe('math markdown', () => {
  it('renders the display and inline formulas in a tutor response', () => {
    const html = renderMarkdownProse([
      '## 结论',
      '',
      '$$x^3 = x^3$$',
      '',
      '- $x^3$ 的含义是 $x \\times x \\times x$',
      '- $x = 2 \\Rightarrow x^3 = 8$',
    ].join('\n'))
    expect(html.match(/class="katex/g)?.length).toBeGreaterThanOrEqual(4)
    expect(html).toContain('katex-display')
    expect(html).not.toContain('$$x^3')
    expect(html).not.toContain('\\Rightarrow')
  })

  it('renders math in question options without changing inline code', () => {
    expect(renderInlineMarkdown('选择 $x^3$')).toContain('class="katex"')
    const html = renderMarkdownProse('`$x^3$` 与 $x^3$')
    expect(html).toContain('<code>$x^3$</code>')
    expect(html.match(/class="katex"/g)).toHaveLength(1)
  })

  it('supports backslash math delimiters', () => {
    expect(renderInlineMarkdown('值为 \\(x^3\\)')).toContain('class="katex"')
    expect(renderMarkdownProse('\\[x^3 = 8\\]')).toContain('katex-display')
  })
})
