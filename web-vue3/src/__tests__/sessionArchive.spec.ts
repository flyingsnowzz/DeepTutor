import { describe, expect, it } from 'vitest'
import {
  archiveCount,
  collectArchivedConversations,
  flattenArchive,
  masteryPathIdOf,
  readingWorkspaceIdOf,
  type SessionSummary,
} from '../sessionArchive'

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    session_id: overrides.session_id ?? 's',
    updated_at: overrides.updated_at ?? 0,
    ...overrides,
  }
}

describe('workspace mode helpers', () => {
  it('reads mastery path id only in mastery_path mode', () => {
    expect(masteryPathIdOf(session({ preferences: { workspace_mode: 'mastery_path', mastery_path_id: 'p1' } }))).toBe('p1')
    expect(masteryPathIdOf(session({ preferences: { workspace_mode: 'other', mastery_path_id: 'p1' } }))).toBe('')
    expect(masteryPathIdOf(session({}))).toBe('')
  })

  it('reads reading workspace id only in immersive_reading mode', () => {
    expect(readingWorkspaceIdOf(session({ preferences: { workspace_mode: 'immersive_reading', reading_workspace_id: 'r1' } }))).toBe('r1')
    expect(readingWorkspaceIdOf(session({ preferences: { workspace_mode: 'x' } }))).toBe('')
  })
})

describe('collectArchivedConversations', () => {
  it('ignores non-archived sessions and buckets the rest', () => {
    const sessions: SessionSummary[] = [
      session({ session_id: 'live', updated_at: 1, preferences: { archived: false } }),
      session({ session_id: 'chat1', updated_at: 2, preferences: { archived: true } }),
      session({
        session_id: 'mastery1',
        updated_at: 3,
        preferences: { archived: true, workspace_mode: 'mastery_path', mastery_path_id: 'topic-a' },
      }),
      session({
        session_id: 'reading1',
        updated_at: 4,
        preferences: { archived: true, workspace_mode: 'immersive_reading', reading_workspace_id: 'coll-a' },
      }),
    ]
    const buckets = collectArchivedConversations({
      sessions,
      masteryTopics: [{ id: 'topic-a', name: '数学' }],
      readingCollections: [{ id: 'coll-a', title: '物理合集' }],
    })
    expect(buckets.chat.map(x => x.session.session_id)).toEqual(['chat1'])
    expect(buckets.mastery[0].container).toBe('数学')
    expect(buckets.reading[0].container).toBe('物理合集')
    expect(archiveCount(buckets)).toBe(3)
  })

  it('skips a child thread whose parent is also archived', () => {
    const sessions: SessionSummary[] = [
      session({ session_id: 'parent', updated_at: 1, preferences: { archived: true } }),
      session({ session_id: 'child', updated_at: 2, preferences: { archived: true, parent_session_id: 'parent' } }),
    ]
    const buckets = collectArchivedConversations({ sessions })
    expect(buckets.chat.map(x => x.session.session_id)).toEqual(['parent'])
  })

  it('lists a hand-archived thread whose parent is not archived', () => {
    const sessions: SessionSummary[] = [
      session({ session_id: 'parent', updated_at: 1, preferences: { archived: false } }),
      session({ session_id: 'child', updated_at: 2, preferences: { archived: true, parent_session_id: 'parent' } }),
    ]
    const buckets = collectArchivedConversations({ sessions })
    expect(buckets.chat.map(x => x.session.session_id)).toEqual(['child'])
  })

  it('sorts each bucket newest-first and flattens in recency order', () => {
    const sessions: SessionSummary[] = [
      session({ session_id: 'a', updated_at: 10, preferences: { archived: true } }),
      session({ session_id: 'b', updated_at: 20, preferences: { archived: true } }),
    ]
    const buckets = collectArchivedConversations({ sessions })
    expect(buckets.chat.map(x => x.session.session_id)).toEqual(['b', 'a'])
    expect(flattenArchive(buckets).map(x => x.session.session_id)).toEqual(['b', 'a'])
  })
})
