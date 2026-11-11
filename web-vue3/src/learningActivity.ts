import { scopedUrl } from './workspaceScope'
import { sessionNavigationPath } from './sessionNavigation'

export type LearningKind = 'books' | 'mastery' | 'reading' | 'watching' | 'practice'
export interface LearningEntry {
  id?: string | number
  path_id?: string
  workspace_id?: string
  session_id?: string
  title?: string
  name?: string
  question?: string
  status?: string
  created_at?: number
  updated_at?: number
  content_workspace_id?: string
  metadata?: { goal?: string; status?: string; created_at?: number; pause_reason?: string }
  reading?: { percent?: number }
  map?: { counts: { total: number; mastered: number } }
  reviews?: { due: boolean; knowledge_point_name: string }[]
  preferences?: Record<string, any>
}
export type LearningSources = Record<LearningKind, LearningEntry[]>
export interface LearningActivity {
  key: string
  kind: LearningKind
  title: string
  href: string
  updatedAt: number
  createdAt: number
  progress?: number
}
const number = (value?: number) => Number(value || 0)
const scope = (path: string, entry: LearningEntry) => scopedUrl(path, entry.content_workspace_id || '')

export function allLearningActivity(sources: LearningSources): LearningActivity[] {
  return [
    ...(sources.practice || []).map(entry => ({
      key: `practice:${entry.content_workspace_id || ''}:${entry.id}`, kind: 'practice' as const,
      title: entry.question || '未命名题目', href: scope(`/learning/practice?question=${encodeURIComponent(String(entry.id))}`, entry),
      updatedAt: number(entry.updated_at || entry.created_at), createdAt: number(entry.created_at || entry.updated_at),
    })),
    ...(sources.books || []).map(entry => ({
      key: `book:${entry.content_workspace_id || ''}:${entry.id}`, kind: 'books' as const,
      title: entry.title || '未命名书籍', href: scope(`/learning/books/${encodeURIComponent(String(entry.id))}`, entry),
      updatedAt: number(entry.updated_at), createdAt: number(entry.created_at || entry.updated_at), progress: number(entry.reading?.percent) / 100,
    })),
    ...(sources.mastery || []).filter(entry => entry.metadata?.status === 'active').map(entry => ({
      key: `topic:${entry.content_workspace_id || ''}:${entry.path_id}`, kind: 'mastery' as const,
      title: entry.name || entry.metadata?.goal || '未命名路径', href: scope(`/learning/mastery/${encodeURIComponent(entry.path_id || '')}`, entry),
      updatedAt: number(entry.updated_at), createdAt: number(entry.metadata?.created_at || entry.updated_at),
      progress: entry.map?.counts.total ? entry.map.counts.mastered / entry.map.counts.total : 0,
    })),
    ...(sources.reading || []).map(entry => ({
      key: `reading:${entry.content_workspace_id || ''}:${entry.workspace_id}`, kind: 'reading' as const,
      title: entry.title || '未命名合集', href: scope(`/learning/reading/${encodeURIComponent(entry.workspace_id || '')}`, entry),
      updatedAt: number(entry.updated_at), createdAt: number(entry.created_at || entry.updated_at),
    })),
    ...(sources.watching || []).filter(entry => entry.preferences?.workspace_mode === 'immersive_watching' || entry.preferences?.capability === 'immersive_watching').map(entry => ({
      key: `session:${entry.content_workspace_id || ''}:${entry.session_id}`, kind: 'watching' as const,
      title: entry.title || '未命名视频', href: sessionNavigationPath({ ...entry, id: String(entry.session_id) } as any),
      updatedAt: number(entry.updated_at), createdAt: number(entry.created_at || entry.updated_at),
    })),
  ].sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key))
}

export function learningTodos(sources: LearningSources) {
  return {
    reviews: (sources.mastery || []).filter(entry => entry.metadata?.status === 'active' && entry.reviews?.some(review => review.due)),
    books: (sources.books || []).filter(entry => entry.status === 'paused' || entry.status === 'compiling').sort((a, b) =>
      Number(b.status === 'paused') - Number(a.status === 'paused') || number(b.updated_at) - number(a.updated_at)),
  }
}
