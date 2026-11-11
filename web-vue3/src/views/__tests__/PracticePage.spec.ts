import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PracticePage from '../PracticePage.vue'
import { api, ApiError } from '../../api'
import { useRoute, useRouter } from 'vue-router'

vi.mock('../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, api: vi.fn() }
})
vi.mock('vue-router', () => ({ useRoute: vi.fn(), useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const route = { path: '/learning/practice', query: {} as Record<string, string> }
const replace = vi.fn()
const question = { entry: { id: 1, question: 'Question', question_type: 'single_choice', options: { A: 'Yes', B: 'No' }, correct_answer: 'A', explanation: 'Because', material_title: 'Math' }, state: { version: 1 } }

describe('PracticePage', () => {
  beforeEach(() => {
    apiMock.mockReset(); replace.mockReset(); route.query = {}
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async path => {
      if (String(path).startsWith('/api/question-notebook/practice/summary')) return { total: 1, mistakes: 0, due: 1, overdue: 0, reviewed_today: 0, next_due_at: null }
      if (String(path).startsWith('/api/question-notebook/practice/queue')) return [question]
      if (String(path).startsWith('/api/question-notebook/practice/questions/1/check')) return { correct: true }
      if (String(path).startsWith('/api/question-notebook/practice/questions/1/review')) return { due_at: 1 }
      if (String(path).startsWith('/api/question-notebook/practice/questions/1')) return question
      if (String(path).startsWith('/api/question-notebook/practice/analytics')) return { daily: [], sources: [], totals: { questions: 0, mistakes: 0, reviews: 0 } }
      return {}
    })
  })

  it('starts a review, checks an answer and submits a rating', async () => {
    const wrapper = mount(PracticePage, { global: { stubs: { RouterLink: true, PracticeImport: true, PracticeInsights: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '开始今日复习')?.trigger('click')
    await flushPromises()
    await wrapper.get('input[type="radio"]').setValue(true)
    await wrapper.findAll('button').find(button => button.text() === '核对并显示答案')?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Because')
    await wrapper.findAll('button').find(button => button.text() === '已掌握')?.trigger('click')
    await flushPromises()
    const review = apiMock.mock.calls.find(call => String(call[0]).includes('/review'))
    expect(JSON.parse(String(review?.[1]?.body)).rating).toBe('good')
    expect(wrapper.text()).toContain('练习完成')
  })

  it('tracks the next due date returned by the review', async () => {
    route.query.question = '1'
    apiMock.mockImplementation(async path => {
      if (String(path).startsWith('/api/question-notebook/practice/summary')) return { total: 1, mistakes: 0, due: 1, overdue: 0, reviewed_today: 0, next_due_at: null }
      if (String(path).startsWith('/api/question-notebook/practice/questions/1/review')) return { due_at: 1765000000 }
      if (String(path).startsWith('/api/question-notebook/practice/questions/1')) return question
      return {}
    })
    const wrapper = mount(PracticePage, { global: { stubs: { RouterLink: true, PracticeImport: true, PracticeInsights: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '我已掌握')?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('下次复习：2025/12/6')
  })

  it('loads a question deep link in its explicit workspace', async () => {
    route.query.question = '1'
    route.query.dt_workspace = 'class-a'
    mount(PracticePage, { global: { stubs: { RouterLink: true, PracticeImport: true, PracticeInsights: true } } })
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith(
      '/api/question-notebook/practice/questions/1?dt_workspace=class-a',
    )
  })

  it('starts a multi-question session from a questions deep link', async () => {
    route.query.questions = '1,2'
    const wrapper = mount(PracticePage, { global: { stubs: { RouterLink: true, PracticeImport: true, PracticeInsights: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('2 道剩余')
    await wrapper.findAll('button').find(button => button.text() === '我已掌握')?.trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/question-notebook/practice/questions/2')
  })

  it('opens import from create=1 and removes the one-shot flag', async () => {
    route.query.create = '1'
    mount(PracticePage, { global: { stubs: { RouterLink: true, PracticeImport: { template: '<div data-test="import" />' }, PracticeInsights: true } } })
    await flushPromises()
    expect(replace).toHaveBeenCalledWith({ path: '/learning/practice', query: {} })
  })

  it('offers a reload after a review version conflict', async () => {
    route.query.question = '1'
    apiMock.mockImplementation(async path => {
      if (String(path).startsWith('/api/question-notebook/practice/summary')) return { total: 1, mistakes: 0, due: 1, overdue: 0, reviewed_today: 0, next_due_at: null }
      if (String(path).startsWith('/api/question-notebook/practice/questions/1/review')) throw new ApiError(409, 'Version changed')
      if (String(path).startsWith('/api/question-notebook/practice/questions/1')) return question
      return {}
    })
    const wrapper = mount(PracticePage, { global: { stubs: { RouterLink: true, PracticeImport: true, PracticeInsights: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '我已掌握')?.trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Version changed')
    expect(wrapper.findAll('button').some(button => button.text() === '重新加载题目')).toBe(true)
  })
})
