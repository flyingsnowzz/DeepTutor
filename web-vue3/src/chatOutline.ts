import { buildVisiblePath, type BranchMessage } from './messageBranches'

export interface OutlineMessage extends BranchMessage { role: string; content: string; capability?: string }
export interface ChatOutlineEntry { key: string; messageId?: number; index: number; ordinal: number; title: string; reply: string; capability?: string; weight: number }
export function turnAnchorKey(message: BranchMessage, index: number): string { return message.id != null ? `m${message.id}` : `i${index}` }
export function plainTextPreview(markdown: string, maxLength = 160): string {
  if (!markdown) return ''
  let text = markdown
  text = text.replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/~~~[\s\S]*?(?:~~~|$)/g, ' ')
  text = text.replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, ' ').replace(/^\s{0,3}>+\s?/gm, '').replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, '')
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>\n]{1,120}>/g, ' ').replace(/`([^`]*)`/g, '$1')
  text = text.replace(/(\*\*|__|~~)(.*?)\1/g, '$2').replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, '$1')
  text = text.replace(/\[\^[^\]]*\]/g, ' ').replace(/\{\{[^}]*\}\}/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length <= maxLength ? text : `${text.slice(0, maxLength).trimEnd()}…`
}
export function buildChatOutline(messages: OutlineMessage[], selectedBranches?: Record<string, number>): ChatOutlineEntry[] {
  const visible = buildVisiblePath(messages, selectedBranches).messages
  const entries: Array<Omit<ChatOutlineEntry, 'weight'>> = []
  for (let index = 0; index < visible.length; index += 1) {
    const message = visible[index]
    if (message.role !== 'user' || message.content.startsWith('[Quiz Performance]')) continue
    const title = plainTextPreview(message.content)
    if (!title) continue
    let reply = ''
    for (let next = index + 1; next < visible.length && visible[next].role !== 'user'; next += 1) {
      if (visible[next].role === 'assistant' && visible[next].content.trim()) { reply = plainTextPreview(visible[next].content, 120); break }
    }
    entries.push({ key: turnAnchorKey(message, index), messageId: message.id, index, ordinal: entries.length + 1, title, reply, capability: message.capability })
  }
  const longest = Math.max(1, ...entries.map(entry => entry.title.length))
  return entries.map(entry => ({ ...entry, weight: Math.max(0.18, entry.title.length / longest) }))
}
