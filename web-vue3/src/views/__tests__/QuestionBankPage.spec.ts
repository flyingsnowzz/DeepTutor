import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import QuestionBankPage from '../QuestionBankPage.vue'
import { api, post } from '../../api'
import { useRoute, useRouter } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: vi.fn(), useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const route = { query: {} as Record<string, string> }
const push = vi.fn()
const question = { id: 1, question: 'What is a vector?', options: { A: 'Direction', B: 'Scalar' }, correct_answer: 'A', explanation: '', user_answer: 'B', source: 'mastery_path', material_id: 'p1', material_title: 'Math', mastery_path_id: 'p1', session_id: 's1', session_title: 'Study', content_workspace_id: 'class', is_correct: false, resolved: false, bookmarked: false, score_trend: 'improved', categories: [], created_at: 1 }

describe('QuestionBankPage', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset(); push.mockReset(); route.query = {}
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async path => {
      if (String(path).startsWith('/api/question-notebook/entries?')) return { items: [question], total: 1 }
      if (path === '/api/question-notebook/categories') return [{ id: 2, name: 'Math', entry_count: 1 }]
      if (path === '/api/question-notebook/stats') return { total: 1, wrong: 1, unresolved: 1, bookmarked: 0, uncategorized: 1 }
      if (path === '/api/question-notebook/materials') return [{ source: 'mastery_path', material_id: 'p1', material_title: 'Math', entry_count: 1, unresolved_count: 1 }]
      return {}
    })
  })

  it('applies source, material and score trend filters and selects the whole page', async () => {
    const wrapper = mount(QuestionBankPage, { global: { stubs: { RouterLink: true, PracticeImport: true, PracticePage: true } } })
    await flushPromises()
    await wrapper.get('select[aria-label="题目来源"]').setValue('mastery_path')
    await wrapper.get('select[aria-label="学习材料"]').setValue('p1')
    await wrapper.get('select[aria-label="成绩趋势"]').setValue('improved')
    await flushPromises()
    const lastList = apiMock.mock.calls.map(call => String(call[0])).filter(path => path.startsWith('/api/question-notebook/entries?')).at(-1)
    expect(lastList).toContain('source=mastery_path')
    expect(lastList).toContain('material_id=p1')
    expect(lastList).toContain('score_trend=improved')
    await wrapper.findAll('button').find(button => button.text() === '选择本页全部')?.trigger('click')
    expect(wrapper.text()).toContain('已选 1 道题')
    await wrapper.get('.question-selection .category-menu-trigger').trigger('click')
    await wrapper.get('.question-selection .category-menu-item').trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/question-notebook/entries/categories/bulk', { entry_ids: [1], category_id: 2, link: true })
  })

  it('opens embedded practice and preserves the original learning destination', async () => {
    const wrapper = mount(QuestionBankPage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' }, PracticeImport: true, PracticePage: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '练习此题')?.trigger('click')
    expect(push).toHaveBeenCalledWith({ path: '/space/questions', query: { question: '1', dt_workspace: 'class' } })
    const origin = wrapper.find('.question-origin')
    expect(origin?.attributes('to')).toBe('/learning/mastery/p1/sessions/s1?dt_workspace=class')
  })

  it('starts every selected question as one practice session', async () => {
    const wrapper = mount(QuestionBankPage, { global: { stubs: { RouterLink: true, PracticeImport: true, PracticePage: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '选择本页全部')?.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '练习所选（1）')?.trigger('click')
    expect(push).toHaveBeenCalledWith({
      path: '/space/questions',
      query: { questions: '1' },
    })
  })

  it('uses the scheduled mistakes filter for the mistakes tab', async () => {
    route.query.view = 'mistakes'
    mount(QuestionBankPage, { global: { stubs: { RouterLink: true, PracticeImport: true, PracticePage: true } } })
    await flushPromises()
    const lastList = apiMock.mock.calls.map(call => String(call[0])).filter(path => path.startsWith('/api/question-notebook/entries?')).at(-1)
    expect(lastList).toContain('mistakes_only=true')
  })

  it('renders the shared practice workflow for a question deep link', async () => {
    route.query.question = '1'
    const wrapper = mount(QuestionBankPage, { global: { stubs: { RouterLink: true, PracticeImport: true, PracticePage: { template: '<div data-test="embedded-practice" />' } } } })
    await flushPromises()
    expect(wrapper.find('[data-test="embedded-practice"]').exists()).toBe(true)
    expect(wrapper.find('.question-layout').exists()).toBe(false)
  })
})
