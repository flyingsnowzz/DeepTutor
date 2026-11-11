import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BooksPage from '../BooksPage.vue'
import { api, post } from '../../api'
import { useRoute, useRouter } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: vi.fn(), useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const route = { fullPath: '/learning/books/b1/pages/p2', params: { bookId: 'b1', pageId: 'p2' } }
const replace = vi.fn()
const page = { id: 'p2', title: 'Second', status: 'ready', order: 2, blocks: [{ id: 'q1', type: 'quiz', title: 'Question', status: 'ready', payload: { question: 'A?', options: { A: 'Yes', B: 'No' }, correct_answer: 'A' } }] }
const detail = { book: { id: 'b1', title: 'Book', description: '', status: 'ready', revision: 2, page_count: 2, chapter_count: 1, can_edit: true, can_delete: true }, spine: { chapters: [] }, pages: [{ id: 'p1', title: 'First', status: 'ready', order: 1, blocks: [] }, page], progress: { current_page_id: 'p2', visited_page_ids: [], bookmarked_page_ids: [] } }

describe('BooksPage', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset(); replace.mockReset()
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async path => {
      if (path === '/api/books') return { books: [], can_create: true }
      if (String(path).startsWith('/api/books/b1?')) return detail
      if (path === '/api/books/b1/pages/p2') return { page }
      return {}
    })
  })

  it('navigates chapters, edits blocks and submits quiz answers', async () => {
    const wrapper = mount(BooksPage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    await flushPromises()
    expect(wrapper.findAll('a').some(link => link.text() === '上一章')).toBe(true)
    expect(wrapper.find('a[download]').attributes('href')).toContain('/api/books/b1/export')
    await wrapper.get('input[type="radio"]').setValue(true)
    await wrapper.findAll('button').find(button => button.text() === '提交答案')?.trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/books/quiz-attempt', expect.objectContaining({ book_id: 'b1', page_id: 'p2', block_id: 'q1', user_answer: 'A', is_correct: true }))
    expect(wrapper.text()).toContain('回答正确')
    await wrapper.findAll('button').find(button => button.text() === '编辑')?.trigger('click')
    await wrapper.get('textarea[aria-label="块内容"]').setValue('Updated')
    await wrapper.get('.book-block form').trigger('submit.prevent')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/books/update-block', expect.objectContaining({ book_id: 'b1', page_id: 'p2', block_id: 'q1', body: 'Updated', expected_revision: 2 }))
  })

  it('inserts a new content block with compilation', async () => {
    const wrapper = mount(BooksPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('input[aria-label="新块标题"]').setValue('New block')
    await wrapper.get('.book-block-editor').get('button').trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/books/insert-block', expect.objectContaining({ block_type: 'paragraph', compile_now: true }))
  })
})
