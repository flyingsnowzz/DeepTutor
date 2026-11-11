import { describe, expect, it } from 'vitest'
import { buildVisiblePath, tipMessageId } from '../messageBranches'
import { buildChatOutline, plainTextPreview } from '../chatOutline'

describe('message branches and chat outline', () => {
  const tree = [
    { id: 1, role: 'user', content: 'First question', parentMessageId: null },
    { id: 2, role: 'assistant', content: 'First answer', parentMessageId: 1 },
    { id: 3, role: 'user', content: 'Original follow-up', parentMessageId: 2 },
    { id: 4, role: 'assistant', content: 'Original answer', parentMessageId: 3 },
    { id: 5, role: 'user', content: 'Edited **follow-up**', parentMessageId: 2 },
    { id: 6, role: 'assistant', content: 'Edited answer', parentMessageId: 5 },
  ]

  it('renders one visible path and exposes chronological siblings', () => {
    const result = buildVisiblePath(tree, {})
    expect(result.messages.map(message => message.id)).toEqual([1, 2, 5, 6])
    expect(result.siblingsByMessageId.get(5)).toMatchObject({ index: 2, total: 2, siblingIds: [3, 5], parentId: 2 })
    const original = buildVisiblePath(tree, { '2': 3 })
    expect(original.messages.map(message => message.id)).toEqual([1, 2, 3, 4])
    expect(original.siblingsByMessageId.get(3)?.index).toBe(1)
  })

  it('prefers the longest continuation unless a branch is explicitly selected', () => {
    const messages = [
      { id: 1, parentMessageId: null }, { id: 2, parentMessageId: 1 }, { id: 3, parentMessageId: 2 },
      { id: 4, parentMessageId: null },
    ]
    expect(buildVisiblePath(messages, {}).messages.map(message => message.id)).toEqual([1, 2, 3])
    expect(buildVisiblePath(messages, { null: 4 }).messages.map(message => message.id)).toEqual([4])
    expect(tipMessageId(buildVisiblePath(messages, {}).messages)).toBe(3)
  })

  it('builds navigator entries from user turns and strips markdown previews', () => {
    const outline = buildChatOutline(tree)
    expect(outline.map(entry => entry.title)).toEqual(['First question', 'Edited follow-up'])
    expect(outline.map(entry => entry.key)).toEqual(['m1', 'm5'])
    expect(outline[1].reply).toBe('Edited answer')
    expect(plainTextPreview('**Bold** [link](https://example.com)')).toBe('Bold link')
  })
})
