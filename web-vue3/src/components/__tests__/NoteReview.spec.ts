import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NoteReview from '../NoteReview.vue'
import { api, post } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)

describe('NoteReview', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset()
    apiMock.mockResolvedValue({ cards: [{ page_id: 'p1', page_title: 'Biology', block_id: 'b1', card_id: 'c1', front: 'Front', back: 'Back' }] })
    postMock.mockResolvedValue({})
  })

  it('reveals and grades a due flashcard', async () => {
    const wrapper = mount(NoteReview, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text().includes('复习记忆卡'))?.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '显示答案')?.trigger('click')
    expect(wrapper.text()).toContain('Back')
    await wrapper.findAll('button').find(button => button.text() === '记住了')?.trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/documents/p1/review', { card_id: 'c1', remembered: true })
    expect(wrapper.find('.modal-backdrop').exists()).toBe(false)
  })
})
