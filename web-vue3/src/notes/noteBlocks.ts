export interface NoteBlock { id: string; type: string; props: Record<string, any>; content?: any; children?: NoteBlock[] }
type InlineStyle = Record<string, unknown>
const editable = new Set(['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'quote', 'codeBlock'])
const label = (block: NoteBlock) => ({ math: '公式', image: '图片', video: '视频', audio: '音频', table: '表格', mermaid: '图表', quiz: '测验', flashcards: '记忆卡', timeline: '时间线', research: '研究' } as Record<string, string>)[block.type] || block.type
const newId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
function inlineText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(item => {
    if (typeof item === 'string') return item
    const row = item as any
    return row.text ?? row.props?.title ?? row.props?.formula ?? inlineText(row.content)
  }).join('')
  return ''
}
function appendInline(parent: HTMLElement, content: unknown) {
  if (typeof content === 'string') { parent.append(content); return }
  if (!Array.isArray(content)) { if (content) parent.append(String(content)); return }
  for (const raw of content as any[]) {
    if (typeof raw === 'string') { parent.append(raw); continue }
    if (raw.type === 'link') {
      const href = String(raw.href || '')
      if (/^(https?:|mailto:|\/|#)/i.test(href)) {
        const anchor = document.createElement('a')
        anchor.href = href
        appendInline(anchor, raw.content)
        parent.append(anchor)
      } else appendInline(parent, raw.content)
      continue
    }
    let node: HTMLElement | Text = document.createTextNode(String(raw.text ?? raw.props?.title ?? raw.props?.formula ?? ''))
    const styles = raw.styles || {}
    const tags: [string, string][] = [['bold', 'strong'], ['italic', 'em'], ['underline', 'u'], ['strike', 's'], ['code', 'code']]
    for (const [key, tag] of tags) if (styles[key]) {
      const element = document.createElement(tag)
      element.append(node)
      node = element
    }
    parent.append(node)
  }
}
function inlineFromNode(node: Node, styles: InlineStyle = {}): any[] {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ? [{ type: 'text', text: node.textContent, styles }] : []
  if (!(node instanceof HTMLElement)) return []
  if (node.tagName === 'BR') return [{ type: 'text', text: '\n', styles }]
  const next = { ...styles }
  if (node.tagName === 'STRONG' || node.tagName === 'B') next.bold = true
  if (node.tagName === 'EM' || node.tagName === 'I') next.italic = true
  if (node.tagName === 'U') next.underline = true
  if (node.tagName === 'S' || node.tagName === 'DEL') next.strike = true
  if (node.tagName === 'CODE' && node.parentElement?.tagName !== 'PRE') next.code = true
  const content = [...node.childNodes].flatMap(child => inlineFromNode(child, next))
  if (node.tagName === 'A') return [{ type: 'link', href: node.getAttribute('href') || '', content }]
  return content
}
function elementWithInline(tag: string, block: NoteBlock) {
  const element = document.createElement(tag)
  element.dataset.blockId = block.id
  appendInline(element, block.content)
  return element
}
export function blocksToHtml(blocks: NoteBlock[]): string {
  const root = document.createElement('div')
  let list: HTMLElement | null = null
  for (const block of blocks) {
    const listTag = block.type === 'bulletListItem' || block.type === 'checkListItem' ? 'ul' : block.type === 'numberedListItem' ? 'ol' : ''
    if (listTag) {
      if (!list || list.tagName.toLowerCase() !== listTag || (block.type === 'checkListItem') !== (list.dataset.type === 'taskList')) {
        list = document.createElement(listTag)
        if (block.type === 'checkListItem') list.dataset.type = 'taskList'
        root.append(list)
      }
      const item = elementWithInline('li', block)
      if (block.type === 'checkListItem') { item.dataset.type = 'taskItem'; item.dataset.checked = String(Boolean(block.props.checked)) }
      list.append(item)
      continue
    }
    list = null
    if (!editable.has(block.type)) {
      const opaque = document.createElement('div')
      opaque.dataset.noteOpaque = block.id
      opaque.dataset.label = label(block)
      opaque.dataset.blockType = block.type
      opaque.dataset.props = JSON.stringify(block.props || {})
      opaque.dataset.content = JSON.stringify(block.content ?? [])
      opaque.textContent = inlineText(block.content) || String(block.props.markdown || block.props.formula || block.props.url || block.props.title || '保留的块内容')
      root.append(opaque)
      continue
    }
    if (block.type === 'paragraph') root.append(elementWithInline('p', block))
    if (block.type === 'heading') root.append(elementWithInline(`h${Math.min(6, Math.max(1, Number(block.props.level || 1)))}`, block))
    if (block.type === 'quote') root.append(elementWithInline('blockquote', block))
    if (block.type === 'codeBlock') root.append(elementWithInline('pre', block))
  }
  return root.innerHTML
}
function baseBlock(element: HTMLElement, type: string, original: Map<string, NoteBlock>): NoteBlock {
  const id = element.dataset.blockId || newId()
  const previous = original.get(id)
  return { id, type, props: previous?.type === type ? { ...previous.props } : {}, content: [...element.childNodes].flatMap(node => inlineFromNode(node, {})), children: [] }
}
export function htmlToBlocks(html: string, previous: NoteBlock[] = []): NoteBlock[] {
  const root = document.createElement('div')
  root.innerHTML = html
  const originals = new Map(previous.map(block => [block.id, block]))
  const result: NoteBlock[] = []
  for (const element of [...root.children] as HTMLElement[]) {
    if (element.dataset.noteOpaque) {
      const original = originals.get(element.dataset.noteOpaque)
      result.push(original ? JSON.parse(JSON.stringify(original)) : { id: element.dataset.noteOpaque, type: element.dataset.blockType || 'paragraph', props: JSON.parse(element.dataset.props || '{}'), content: JSON.parse(element.dataset.content || '[]'), children: [] })
      continue
    }
    const tag = element.tagName.toLowerCase()
    if (/^h[1-6]$/.test(tag)) {
      const block = baseBlock(element, 'heading', originals)
      block.props.level = Math.min(6, Number(tag.slice(1)))
      result.push(block)
    } else if (tag === 'p') result.push(baseBlock(element, 'paragraph', originals))
    else if (tag === 'blockquote') result.push(baseBlock(element, 'quote', originals))
    else if (tag === 'pre') result.push(baseBlock(element, 'codeBlock', originals))
    else if (tag === 'ul' || tag === 'ol') {
      for (const item of [...element.children] as HTMLElement[]) {
        const task = item.dataset.type === 'taskItem' || element.dataset.type === 'taskList'
        const block = baseBlock(item, task ? 'checkListItem' : tag === 'ul' ? 'bulletListItem' : 'numberedListItem', originals)
        if (task) block.props.checked = item.dataset.checked === 'true'
        result.push(block)
      }
    } else if (element.textContent) result.push(baseBlock(element, 'paragraph', originals))
  }
  return result
}
