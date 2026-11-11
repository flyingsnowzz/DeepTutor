export interface ComposerMentionItem { key: string; label: string; description: string; icon: string; count: number }
export function trailingMention(value: string): { start: number; query: string } | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(value)
  if (!match) return null
  return { start: match.index + match[0].lastIndexOf('@'), query: match[1] }
}
