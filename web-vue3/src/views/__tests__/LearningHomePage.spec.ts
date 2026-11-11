import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LearningHomePage from '../LearningHomePage.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn() }))
const apiMock = vi.mocked(api)
const payload = {
  failed: [],
  sources: {
    books: [{ id: 'b1', title: 'Book', status: 'paused', updated_at: 20, metadata: { pause_reason: 'quota' } }],
    mastery: [{ path_id: 'p1', name: 'Topic', updated_at: 30, metadata: { status: 'active' }, map: { counts: { total: 2, mastered: 1 } }, reviews: [{ due: true, knowledge_point_name: 'Vectors' }] }],
    reading: [], watching: [], practice: [{ id: 7, question: 'Question', updated_at: 50 }],
  },
}

describe('LearningHomePage', () => {
  beforeEach(() => { apiMock.mockReset(); sessionStorage.clear() })

  it('renders todos and recent records, filters records and hands off a review prompt', async () => {
    apiMock.mockResolvedValue(payload)
    const wrapper = mount(LearningHomePage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    await flushPromises()
    expect(wrapper.text()).toContain('需要你的关注')
    expect(wrapper.text()).toContain('1 项复习已到期')
    expect(wrapper.text()).toContain('已暂停 · quota')
    const review = wrapper.findAll('a').find(link => link.text().includes('1 项复习已到期'))
    await review?.trigger('click')
    expect(sessionStorage.getItem('deeptutor.pendingPrompt.mastery_opening')).toContain('Vectors')
    const buttons = wrapper.findAll('button')
    await buttons.find(button => button.text() === '练习')?.trigger('click')
    expect(wrapper.text()).toContain('Question')
    expect(wrapper.text()).not.toContain('学习记录Book')
    wrapper.unmount()
  })

  it('keeps previously loaded records after a transient refresh failure', async () => {
    apiMock.mockResolvedValueOnce(payload).mockRejectedValueOnce(new Error('offline'))
    const wrapper = mount(LearningHomePage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '刷新')?.trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('部分学习资料暂时无法加载')
    expect(wrapper.text()).toContain('Book')
    expect(wrapper.text()).toContain('Question')
    wrapper.unmount()
  })
})
