import { describe, expect, it } from 'vitest'
import { selectedBooksToPayload, type SelectedBookReference } from '../bookReferences'

describe('book reference payload', () => {
  it('groups unique page ids by book and drops empty selections', () => {
    const refs: SelectedBookReference[] = [
      { bookId: 'b1', bookTitle: 'Calculus', pages: [{ bookId: 'b1', bookTitle: 'Calculus', pageId: 'p1', pageTitle: 'Limits' }, { bookId: 'b1', bookTitle: 'Calculus', pageId: 'p1', pageTitle: 'Limits' }, { bookId: 'b1', bookTitle: 'Calculus', pageId: 'p2', pageTitle: 'Derivatives' }] },
      { bookId: 'b2', bookTitle: 'Empty', pages: [] },
    ]
    expect(selectedBooksToPayload(refs)).toEqual([{ book_id: 'b1', page_ids: ['p1', 'p2'] }])
  })
})
