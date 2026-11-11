/**
 * Archived conversation bucketing — split archived sessions into chat /
 * mastery / reading surfaces. Port of web/lib/session-archive.ts and the
 * workspace-mode rules in web/lib/mastery-session.ts. Pure functions only.
 */

export interface SessionPreferences {
  archived?: boolean
  parent_session_id?: string | null
  workspace_mode?: string
  mastery_path_id?: string
  reading_workspace_id?: string
  [key: string]: unknown
}

export interface SessionSummary {
  session_id: string
  title?: string
  updated_at: number
  preferences?: SessionPreferences
  [key: string]: unknown
}

export type ArchiveKind = 'chat' | 'mastery' | 'reading'

export interface ArchivedConversation {
  session: SessionSummary
  kind: ArchiveKind
  container: string
}

export interface ArchiveBuckets {
  chat: ArchivedConversation[]
  mastery: ArchivedConversation[]
  reading: ArchivedConversation[]
}

export interface LabeledItem {
  id: string
  name?: string
  title?: string
}

export interface ArchiveInput {
  sessions: readonly SessionSummary[]
  masteryTopics?: readonly LabeledItem[]
  readingCollections?: readonly LabeledItem[]
}

export function masteryPathIdOf(session: SessionSummary): string {
  const preferences = session.preferences
  if (!preferences || preferences.workspace_mode !== 'mastery_path') return ''
  return String(preferences.mastery_path_id || '')
}

export function readingWorkspaceIdOf(session: SessionSummary): string {
  const preferences = session.preferences
  if (!preferences || preferences.workspace_mode !== 'immersive_reading') return ''
  return String(preferences.reading_workspace_id || '')
}

function byRecency(a: ArchivedConversation, b: ArchivedConversation): number {
  return b.session.updated_at - a.session.updated_at
}

/**
 * Bucket archived sessions. A tutor thread whose parent is also archived is
 * skipped — the backend archives/restores them together, so a separate row
 * would offer a restore button that no-ops on its own.
 */
export function collectArchivedConversations({
  sessions,
  masteryTopics = [],
  readingCollections = [],
}: ArchiveInput): ArchiveBuckets {
  const topics = new Map(masteryTopics.map(topic => [topic.id, topic.name ?? '']))
  const collections = new Map(readingCollections.map(item => [item.id, item.title ?? '']))
  const archivedIds = new Set(
    sessions.filter(session => session.preferences?.archived).map(session => session.session_id),
  )

  const buckets: ArchiveBuckets = { chat: [], mastery: [], reading: [] }
  for (const session of sessions) {
    if (!session.preferences?.archived) continue
    const parentId = String(session.preferences?.parent_session_id || '')
    if (parentId && archivedIds.has(parentId)) continue

    const topicId = masteryPathIdOf(session)
    if (topicId) {
      buckets.mastery.push({ session, kind: 'mastery', container: topics.get(topicId) ?? '' })
      continue
    }
    const collectionId = readingWorkspaceIdOf(session)
    if (collectionId) {
      buckets.reading.push({
        session,
        kind: 'reading',
        container: collections.get(collectionId) ?? '',
      })
      continue
    }
    buckets.chat.push({ session, kind: 'chat', container: '' })
  }

  buckets.chat.sort(byRecency)
  buckets.mastery.sort(byRecency)
  buckets.reading.sort(byRecency)
  return buckets
}

export function archiveCount(buckets: ArchiveBuckets): number {
  return buckets.chat.length + buckets.mastery.length + buckets.reading.length
}

export function flattenArchive(buckets: ArchiveBuckets): ArchivedConversation[] {
  return [...buckets.chat, ...buckets.mastery, ...buckets.reading].sort(byRecency)
}
