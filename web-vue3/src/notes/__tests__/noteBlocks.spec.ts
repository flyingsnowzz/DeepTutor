import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { blocksToHtml, htmlToBlocks, type NoteBlock } from '../noteBlocks'

const blocks: NoteBlock[] = [
  { id: 'h1', type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Title', styles: { bold: true } }], children: [] },
  { id: 'p1', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Read ', styles: {} }, { type: 'link', href: 'https://example.com', content: [{ type: 'text', text: 'source', styles: { italic: true } }] }], children: [] },
  { id: 'b1', type: 'bulletListItem', props: {}, content: [{ type: 'text', text: 'One', styles: {} }], children: [] },
  { id: 't1', type: 'checkListItem', props: { checked: true }, content: [{ type: 'text', text: 'Done', styles: {} }], children: [] },
  { id: 'c1', type: 'codeBlock', props: { language: 'ts' }, content: [{ type: 'text', text: 'const x = 1', styles: {} }], children: [] },
  { id: 'm1', type: 'math', props: { formula: 'x^2', custom: { keep: true } }, content: [], children: [] },
]

describe('note block conversion', () => {
  it('round-trips rich text, list state, ids and opaque blocks', () => {
    const result = htmlToBlocks(blocksToHtml(blocks), reactive(blocks))
    expect(result.map(block => block.id)).toEqual(blocks.map(block => block.id))
    expect(result.map(block => block.type)).toEqual(blocks.map(block => block.type))
    expect(result[0].content[0].styles.bold).toBe(true)
    expect(result[1].content[1].type).toBe('link')
    expect(result[1].content[1].content[0].styles.italic).toBe(true)
    expect(result[3].props.checked).toBe(true)
    expect(result[4].props.language).toBe('ts')
    expect(result[5]).toEqual(blocks[5])
  })

  it('preserves the id of a later paragraph when an earlier block is deleted', () => {
    const two = [
      { id: 'first', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'First', styles: {} }] },
      { id: 'second', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Second', styles: {} }] },
    ]
    const html = blocksToHtml(two).replace(/<p data-block-id="first">.*?<\/p>/, '')
    expect(htmlToBlocks(html, two)[0].id).toBe('second')
  })

  it('preserves heading levels four through six from the legacy toolbar', () => {
    const headings: NoteBlock[] = [4, 5, 6].map(level => ({ id: `h${level}`, type: 'heading', props: { level }, content: [{ type: 'text', text: `Heading ${level}`, styles: {} }], children: [] }))
    expect(htmlToBlocks(blocksToHtml(headings), headings).map(block => block.props.level)).toEqual([4, 5, 6])
  })

  it('does not create anchors for unsafe link protocols', () => {
    const unsafe: NoteBlock[] = [{ id: 'x', type: 'paragraph', props: {}, content: [{ type: 'link', href: 'javascript:alert(1)', content: [{ type: 'text', text: 'bad', styles: {} }] }] }]
    expect(blocksToHtml(unsafe)).not.toContain('<a')
    expect(blocksToHtml(unsafe)).toContain('bad')
  })
})

describe('note block insertion metadata', () => {
  it('retains a newly inserted special block without a previous copy', () => {
    const block: NoteBlock = { id: 'quiz-1', type: 'learning', props: { kind: 'quiz', data: JSON.stringify({ questions: [{ question: 'Q', options: { A: 'Yes' }, correct_answer: 'A' }] }) }, content: [], children: [] }
    const [result] = htmlToBlocks(blocksToHtml([block]), [])
    expect(result.type).toBe('learning')
    expect(result.props.kind).toBe('quiz')
    expect(JSON.parse(result.props.data).questions[0].question).toBe('Q')
  })
})
