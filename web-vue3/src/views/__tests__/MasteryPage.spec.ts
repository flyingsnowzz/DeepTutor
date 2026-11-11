import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MasteryPage from '../MasteryPage.vue'
import { api, post } from '../../api'
import { useRoute, useRouter } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: vi.fn(), useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const route = { params: { pathId: '' } }
const push = vi.fn()
const topic = { path_id: 'p1', name: 'Math', metadata: { goal: 'Learn math', emoji: '🧭' }, map: { counts: { mastered: 0, learning: 0, new: 1, total: 1 }, due_reviews: 0, modules: [{ id: 'm1', name: 'Basics', order: 0, mastered: 0, total: 1, knowledge_points: [{ id: 'k1', name: 'Vectors', type: 'concept', status: 'new', mastery: 0 }] }] }, session_count: 0, reviews: [] }

describe('MasteryPage', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset(); push.mockReset(); route.params.pathId = ''
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async path => {
      if (path === '/api/knowledge-bases/list') return [{ name: 'kb1' }]
      if (path === '/api/notebooks') return { notebooks: [] }
      if (path === '/api/mastery-paths/topics') return { topics: [] }
      return {}
    })
    postMock.mockResolvedValue(topic)
  })

  it('creates a goal with selected sources and opens an outline conversation', async () => {
    const wrapper = mount(MasteryPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('textarea').setValue('Learn linear algebra')
    await wrapper.get('form').trigger('submit.prevent')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/mastery-paths/topics', expect.objectContaining({ goal: 'Learn linear algebra', sources: expect.arrayContaining([expect.objectContaining({ kind: 'knowledge_base', source_id: 'kb1' })]) }))
    expect(push).toHaveBeenCalledWith('/learning/mastery/p1/sessions?mode=outline')
    expect(sessionStorage.getItem('deeptutor.pendingPrompt.mastery_opening')).toContain('design the outline')
  })

  it('shows the legacy gate, review, attempts and retention evidence for an objective', async () => {
    route.params.pathId = 'p1'
    const report = {
      id: 'k1', name: 'Vectors', type: 'concept', module_name: 'Basics', status: 'learning', gate: 'quantitative', mastery: 0.65, threshold: 0.85, mastered: false, assessed_mastered: false, mastery_source: 'system', override_note: '', explanation: '', correct_count: 1,
      review: { due_at: 2000, stability: 2.5, retrievability: 0.72, lapse_count: 1, forgetting_risk: 0.28, reason: 'Scheduled review' },
      attempts: [{ question_id: 'q1', prompt: 'What is a vector?', answer: 'A direction and magnitude', is_correct: true, at: 1000 }],
      errors: [{ id: 'e1', error_type: 'Sign confusion', retries: 2, status: 'open' }],
      evidence: [{ timestamp: 1000, turn_id: 't1', result: 'correct', assessment_type: 'quiz', quality: 1 }], evidence_count: 1,
    }
    apiMock.mockImplementation(async path => {
      if (path === '/api/mastery-paths/topics/p1') return topic
      if (path === '/api/mastery-paths/topics/p1/sessions') return { sessions: [] }
      if (path === '/api/mastery-paths/progress/p1/board') return { cards: [] }
      if (path === '/api/mastery-paths/progress/p1/objectives/k1') return { objective: report }
      return topic
    })
    const wrapper = mount(MasteryPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('.mastery-objective-row').trigger('click')
    await flushPromises()
    const detail = wrapper.get('.mastery-objective-detail')
    expect(detail.text()).toContain('定量门槛：85%')
    expect(detail.text()).toContain('记忆保持 72% · 稳定度 2.5 天')
    expect(detail.text()).toContain('What is a vector?')
    expect(detail.text()).toContain('Sign confusion · 重试 2 次')
    expect(detail.text()).toContain('保持证据（1）')
    await wrapper.findAll('button').find(button => button.text() === '标记掌握')?.trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/mastery-paths/topics/p1/objectives/k1/override', { mastered: true, note: '' })
  })

  it('edits the route and resets progress with redo rather than deletion', async () => {
    route.params.pathId = 'p1'
    apiMock.mockImplementation(async path => {
      if (path === '/api/mastery-paths/topics/p1') return topic
      if (path === '/api/mastery-paths/topics/p1/sessions') return { sessions: [] }
      if (path === '/api/mastery-paths/progress/p1/board') return { cards: [] }
      return topic
    })
    vi.stubGlobal('confirm', vi.fn(() => true))
    const wrapper = mount(MasteryPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '编辑路线')?.trigger('click')
    await wrapper.get('input[aria-label="模块 1 名称"]').setValue('Foundations')
    await wrapper.findAll('button').find(button => button.text() === '保存路线')?.trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/mastery-paths/topics/p1/map', expect.objectContaining({ method: 'PUT', body: expect.stringContaining('Foundations') }))
    await wrapper.findAll('button').find(button => button.text() === '重置进度')?.trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/mastery-paths/progress/p1/redo', {})
    expect(postMock).not.toHaveBeenCalledWith('/api/mastery-paths/progress/p1', {})
  })
})
