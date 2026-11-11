import { beforeEach, describe, expect, it } from 'vitest'
import { sessionNavigationPath } from '../sessionNavigation'

describe('sessionNavigationPath', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    window.sessionStorage.clear()
    window.localStorage.clear()
  })

  it('retains the reading workspace and authoritative content scope', () => {
    expect(sessionNavigationPath({
      id: 'session/1',
      content_workspace_id: 'class A',
      preferences: { workspace_mode: 'immersive_reading', reading_workspace_id: 'reading/1' },
    })).toBe('/learning/reading/reading%2F1/sessions/session%2F1?dt_workspace=class+A')
  })

  it('routes mastery, book, note and ordinary sessions to their owning surfaces', () => {
    expect(sessionNavigationPath({ id: 's1', preferences: { workspace_mode: 'mastery_path', mastery_path_id: 'p1' } }))
      .toBe('/learning/mastery/p1/sessions/s1?dt_workspace=')
    expect(sessionNavigationPath({ id: 's2', preferences: { book_id: 'b1', book_page_id: 'pg 1' } }))
      .toBe('/learning/books/b1/pages/pg%201?chat=s2&dt_workspace=')
    expect(sessionNavigationPath({ id: 's3', preferences: { note_document_id: 'n1' } }))
      .toBe('/co-writer/n1?chat=s3&dt_workspace=')
    expect(sessionNavigationPath({ id: 's4' })).toBe('/chat/s4?dt_workspace=')
  })
})
