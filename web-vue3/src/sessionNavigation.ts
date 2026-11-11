import { scopedUrl } from './workspaceScope'

export interface SessionPreferences {
  workspace_id?: string
  workspace_mode?: string
  capability?: string
  mastery_path_id?: string
  reading_workspace_id?: string
  book_id?: string
  book_page_id?: string
  note_document_id?: string
}

export interface SessionNavigationTarget {
  id: string
  content_workspace_id?: string
  preferences?: SessionPreferences
}

/** Keep every history entry on the product surface that owns its context. */
export function sessionNavigationPath(session: SessionNavigationTarget): string {
  const id = encodeURIComponent(session.id)
  const preferences = session.preferences
  const workspaceId = session.content_workspace_id ?? preferences?.workspace_id ?? ''
  let path = `/chat/${id}`

  if (preferences?.workspace_mode === 'mastery_path' && preferences.mastery_path_id) {
    path = `/learning/mastery/${encodeURIComponent(preferences.mastery_path_id)}/sessions/${id}`
  } else if (preferences?.workspace_mode === 'immersive_reading' && preferences.reading_workspace_id) {
    path = `/learning/reading/${encodeURIComponent(preferences.reading_workspace_id)}/sessions/${id}`
  } else if (preferences?.book_id) {
    const book = `/learning/books/${encodeURIComponent(preferences.book_id)}`
    path = preferences.book_page_id
      ? `${book}/pages/${encodeURIComponent(preferences.book_page_id)}?chat=${id}`
      : `${book}?chat=${id}`
  } else if (preferences?.note_document_id) {
    path = `/co-writer/${encodeURIComponent(preferences.note_document_id)}?chat=${id}`
  } else if (preferences?.workspace_mode === 'immersive_watching' || preferences?.capability === 'immersive_watching') {
    path = `/learning/watching/${id}`
  }

  return scopedUrl(path, workspaceId)
}
