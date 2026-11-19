import { Marked } from 'marked'
import katex from 'katex'
import DOMPurify from 'dompurify'

type MathToken = { type: string; raw: string; text: string }

const markdown = new Marked({ gfm: true, breaks: true })

function renderMath(text: string, displayMode: boolean): string {
  return katex.renderToString(text.trim(), {
    displayMode,
    throwOnError: false,
    output: 'html',
    strict: 'ignore',
    trust: false,
  })
}

markdown.use({
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      tokenizer(source: string): MathToken | undefined {
        const match = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])(?:[ \t]*\n)?/.exec(source)
        const text = (match?.[1] ?? match?.[2] ?? '').trim()
        return match && text ? { type: 'mathBlock', raw: match[0], text } : undefined
      },
      renderer(token): string {
        return renderMath(String(token.text ?? ''), true)
      },
    },
    {
      name: 'mathInline',
      level: 'inline',
      start(source: string): number | undefined {
        const index = source.search(/\$|\\\(/)
        return index < 0 ? undefined : index
      },
      tokenizer(source: string): MathToken | undefined {
        const match = /^(?:\$(?!\$)(?!\s)((?:\\.|[^\\$\n])+?)\$|\\\(([^\n]+?)\\\))/.exec(source)
        const text = (match?.[1] ?? match?.[2] ?? '').trim()
        return match && text ? { type: 'mathInline', raw: match[0], text } : undefined
      },
      renderer(token): string {
        return renderMath(String(token.text ?? ''), false)
      },
    },
  ],
})

export function renderMarkdownProse(source: string): string {
  return DOMPurify.sanitize(markdown.parse(source, { async: false }) as string)
}

export function renderInlineMarkdown(source: string): string {
  return DOMPurify.sanitize(markdown.parseInline(source, { async: false }) as string)
}
