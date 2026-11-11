import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RESOURCE_REUSE,
  normalizeResourceReuse,
  retainedKnowledgeBases,
} from '../resourceReuse'

describe('resourceReuse', () => {
  it('keeps one-shot references off and durable knowledge, persona and tools on by default', () => {
    expect(DEFAULT_RESOURCE_REUSE).toMatchObject({
      attachments: false,
      books: false,
      chat_history: false,
      question_bank: false,
      knowledge: true,
      persona: true,
      skills: true,
      mcp: true,
    })
  })

  it('normalizes partial policies without dropping legacy resource kinds', () => {
    expect(normalizeResourceReuse({ books: true, persona: false })).toEqual({
      ...DEFAULT_RESOURCE_REUSE,
      books: true,
      persona: false,
    })
  })

  it('retains knowledge bases and connected agents under their own policies', () => {
    const agents = new Set(['Codex'])
    expect(retainedKnowledgeBases(['Algebra', 'Codex'], agents, DEFAULT_RESOURCE_REUSE)).toEqual([
      'Algebra',
      'Codex',
    ])
    expect(retainedKnowledgeBases(['Algebra', 'Codex'], agents, normalizeResourceReuse({
      knowledge: false,
      agent: true,
    }))).toEqual(['Codex'])
    expect(retainedKnowledgeBases(['Algebra', 'Codex'], agents, normalizeResourceReuse({
      knowledge: true,
      agent: false,
    }))).toEqual(['Algebra'])
  })
})
