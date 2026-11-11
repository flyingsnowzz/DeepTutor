export interface SelectedBookPage { bookId: string; bookTitle: string; pageId: string; pageTitle: string; chapterId?: string; chapterTitle?: string }
export interface SelectedBookReference { bookId: string; bookTitle: string; pages: SelectedBookPage[] }
export interface BookReferencePayload { book_id: string; page_ids: string[] }
export function selectedBooksToPayload(refs: SelectedBookReference[]): BookReferencePayload[] {
  return refs.map(ref => ({ book_id: ref.bookId, page_ids: Array.from(new Set(ref.pages.map(page => page.pageId))).filter(Boolean) })).filter(ref => ref.book_id && ref.page_ids.length > 0)
}
