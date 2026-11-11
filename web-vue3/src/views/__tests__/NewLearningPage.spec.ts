import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NewLearningPage from '../NewLearningPage.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn() }))
const apiMock = vi.mocked(api)
function mockLoad({ policy = undefined as string[] | undefined, hidden = [] as string[], modules = [] as any[] } = {}) {
  apiMock.mockImplementation(async (path, init) => {
    if (path === '/api/modules') return { modules }
    if (path === '/api/auth/status') return policy === undefined ? {} : { learning_policy: { allowed_surfaces: policy } }
    if (path === '/api/settings/page-customization') return { learning: { hidden_features: hidden } }
    if (path === '/api/settings/page-customization/learning' && init?.method === 'PUT') return { learning: JSON.parse(String(init.body)) }
    throw new Error(`Unexpected request: ${path}`)
  })
}

describe('NewLearningPage', () => {
  beforeEach(() => { apiMock.mockReset() })

  it('filters surfaces by module ownership and account policy', async () => {
    mockLoad({ policy: ['chat', 'reading'], modules: [
      { installed: true, enabled: true, navigation: ['/learning/mastery'] },
      { installed: false, enabled: false, navigation: ['/learning/practice'] },
    ] })
    const wrapper = mount(NewLearningPage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    await flushPromises()
    expect(wrapper.text()).toContain('精通之路')
    expect(wrapper.text()).toContain('沉浸式阅读')
    expect(wrapper.text()).not.toContain('管理题库、整理错题，每天巩固所学')
    expect(wrapper.text()).not.toContain('生成、浏览并学习你的 AI 编写书籍')
    const links = wrapper.findAll('a')
    expect(links.some(link => link.text().includes('练习'))).toBe(false)
  })

  it('uses safe default surfaces when a policy has no allowed entries', async () => {
    mockLoad({ policy: [] })
    const wrapper = mount(NewLearningPage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    await flushPromises()
    expect(wrapper.text()).toContain('精通之路')
    expect(wrapper.text()).toContain('沉浸式阅读')
    expect(wrapper.text()).not.toContain('生成、浏览并学习你的 AI 编写书籍')
  })

  it('persists hidden features and restores them through customization', async () => {
    mockLoad({ hidden: ['books'] })
    const wrapper = mount(NewLearningPage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('生成、浏览并学习你的 AI 编写书籍')
    await wrapper.get('.new-learning-customize-button').trigger('click')
    await flushPromises()
    const bookSwitch = document.querySelector<HTMLButtonElement>('.chat-customize-choice')
    expect(bookSwitch?.getAttribute('aria-checked')).toBe('false')
    bookSwitch?.click()
    const save = [...document.querySelectorAll<HTMLButtonElement>('.chat-customize-footer button')].find(button => button.textContent === '保存')
    save?.click()
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/settings/page-customization/learning', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ hidden_features: [] }) }))
    expect(wrapper.text()).toContain('生成、浏览并学习你的 AI 编写书籍')
  })

  it('fails closed when module inventory is unavailable', async () => {
    apiMock.mockImplementation(async path => {
      if (path === '/api/modules') throw new Error('Inventory unavailable')
      if (path === '/api/auth/status') return {}
      return { learning: { hidden_features: [] } }
    })
    const wrapper = mount(NewLearningPage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('学习模块清单加载失败')
    expect(wrapper.findAll('a')).toHaveLength(0)
    expect(wrapper.find('details').exists()).toBe(false)
  })
})
