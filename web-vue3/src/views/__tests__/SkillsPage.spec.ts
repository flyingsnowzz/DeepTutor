import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SkillsPage from '../SkillsPage.vue'
import { api, post } from '../../api'
import { useRoute, useRouter } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: vi.fn(), useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const skill = { name: 'research-helper', description: 'Research', content: '# Research', tags: ['research'], source: 'user', read_only: false }

describe('SkillsPage', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset(); vi.restoreAllMocks()
    vi.mocked(useRoute).mockReturnValue({ query: { skill_workspace: 'team A' } } as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace: vi.fn() } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async (path, init) => {
      if (String(path).startsWith('/api/skills/list')) return { skills: [skill] }
      if (String(path).startsWith('/api/skills/tags/list')) return { tags: ['research'] }
      if (String(path).startsWith('/api/settings/workspace/resource-usage')) return { workspaces: [{ display_name: 'Classroom' }] }
      if (String(path).startsWith('/api/skills/research-helper') && !init) return skill
      return {}
    })
  })

  it('preserves skill workspace scope and creates a skill with normalized tags', async () => {
    const wrapper = mount(SkillsPage, { global: { stubs: { RouterLink: true, EduHubImport: true } } })
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/skills/list?skill_workspace=team%20A')
    await wrapper.findAll('button').find(button => button.text() === '新建技能')?.trigger('click')
    await wrapper.get('input[placeholder="research-helper"]').setValue('Writing Helper!')
    await wrapper.get('input[placeholder="research, writing"]').setValue('Writing, research, writing')
    await wrapper.get('.resource-editor form').trigger('submit.prevent')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/skills/create?skill_workspace=team%20A', expect.objectContaining({ name: 'writing-helper', tags: ['writing', 'research'] }))
  })

  it('shows workspace impact before deleting and keeps read-only skills protected', async () => {
    apiMock.mockImplementation(async path => {
      if (String(path).startsWith('/api/skills/list')) return { skills: [skill, { ...skill, name: 'admin-skill', source: 'admin', read_only: true }] }
      if (String(path).startsWith('/api/skills/tags/list')) return { tags: ['research'] }
      if (String(path).startsWith('/api/settings/workspace/resource-usage')) return { workspaces: [{ display_name: 'Classroom' }] }
      return {}
    })
    vi.stubGlobal('confirm', vi.fn(() => true))
    const wrapper = mount(SkillsPage, { global: { stubs: { RouterLink: true, EduHubImport: true } } })
    await flushPromises()
    const cards = wrapper.findAll('.partner-card')
    expect(cards[1].findAll('.partner-actions button')).toHaveLength(1)
    await cards[0].findAll('button').find(button => button.text() === '删除')?.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Classroom'))
    expect(apiMock).toHaveBeenCalledWith('/api/skills/research-helper?skill_workspace=team%20A', { method: 'DELETE' })
  })
})
