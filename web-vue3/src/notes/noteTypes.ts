export interface NoteBlock {
  id: string
  type: string
  props: Record<string, unknown>
  content?: unknown
  children?: NoteBlock[]
}

export interface NoteSummary {
  id: string
  title: string
  parent_id: string | null
  icon: string
  cover?: string
  pinned: boolean
  revision: number
  updated_at?: number
}

export interface NotePage extends NoteSummary {
  content: string
  blocks: NoteBlock[] | null
  cover: string
}

export type NoteMetadataPatch = Partial<Pick<NotePage, 'parent_id' | 'icon' | 'cover' | 'pinned'>>

export interface FavoriteItem {
  id: string
  type: string
  title: string
  summary?: string
  output?: string
  created_at?: number
  metadata?: Record<string, unknown>
  collection: { id: string; name: string; color?: string; unreadable?: boolean }
}
