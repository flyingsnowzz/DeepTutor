import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PartnerCreatePage from '../PartnerCreatePage.vue'
import { api, post } from '../../api'
import { useRouter } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const push = vi.fn()

describe('PartnerCreatePage group', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset(); push.mockReset()
    vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async path => {
      if (path === '/api/partners') return [{ partner_id: 'p1', name: 'One', description: 'First' }, { partner_id: 'p2', name: 'Two', description: 'Second' }]
      if (path === '/api/partner-groups/discussion-modes') return [{ name: 'panel_parallel', label: '', description: '' }, { name: 'debate', label: '', description: '' }]
      return []
    })
    postMock.mockResolvedValue({ group_id: 'g1' })
  })

  it('requires two members and creates a group with the selected discussion mode', async () => {
    const wrapper = mount(PartnerCreatePage, { props: { kind: 'group' }, global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.find('button.primary').attributes('disabled')).toBeDefined()
    await wrapper.get('input[maxlength="80"]').setValue('Study group')
    await wrapper.get('input[value="p1"]').setValue(true)
    await wrapper.get('input[value="p2"]').setValue(true)
    await wrapper.get('input[value="debate"]').setValue(true)
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/partner-groups', expect.objectContaining({ name: 'Study group', member_ids: ['p1', 'p2'], discussion_mode: 'debate', shared_memory: 'whiteboard' }))
    expect(push).toHaveBeenCalledWith('/partners/groups/g1')
  })
})

describe('PartnerCreatePage partner wizard', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset(); push.mockReset()
    vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async path => {
      if (path === '/api/partners/soul-sources') return { library: [{ id: 'mentor', name: 'Mentor', content: 'Be kind' }], personas: [] }
      if (path === '/api/settings/llm-options') return { active: { profile_id: 'default', model_id: 'chat' }, options: [{ profile_id: 'default', model_id: 'chat', profile_name: 'Default', model_name: 'Chat' }, { profile_id: 'backup', model_id: 'reason', profile_name: 'Backup', model_name: 'Reason' }] }
      if (path === '/api/partners/tool-options') return { tools: [{ name: 'web_search', description: '' }], builtin_tools: [{ name: 'rag' }], mcp_tools: [{ name: 'mcp' }] }
      if (path === '/api/settings/workspace/registrations') return { workspaces: [] }
      if (path === '/api/knowledge-bases/list') return [{ name: 'kb1' }]
      if (path === '/api/skills/list') return { skills: [{ name: 'research' }] }
      if (path === '/api/notebooks') return { notebooks: [] }
      return []
    })
    postMock.mockResolvedValue({ partner_id: 'p1' })
  })

  it('creates a partner with soul, backup model, tools and copied assets', async () => {
    const wrapper = mount(PartnerCreatePage, { props: { kind: 'partner' }, global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('input[maxlength="80"]').setValue('Researcher')
    for (let index = 0; index < 2; index++) await wrapper.get('form').trigger('submit.prevent')
    await wrapper.get('.partner-model-select > button').trigger('click')
    await wrapper.findAll('[role="option"]').find(option => option.text().includes('Reason'))!.trigger('click')
    await wrapper.get('.partner-tool-grid input[type="checkbox"]').setValue(false)
    await wrapper.get('form').trigger('submit.prevent')
    await wrapper.findAll('.partner-asset-chips > button').find(button => button.text() === 'kb1')!.trigger('click')
    await wrapper.get('form').trigger('submit.prevent')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    const payload = postMock.mock.calls[0][1] as any
    expect(payload.soul).toMatchObject({ source: 'library', id: 'mentor', content: 'Be kind' })
    expect(payload.backup_llm_selection).toEqual({ profile_id: 'backup', model_id: 'reason' })
    expect(payload.enabled_tools).toEqual([])
    expect(payload.assets.knowledge_bases).toEqual(['kb1'])
    expect(payload.start).toBe(true)
    expect(push).toHaveBeenCalledWith('/partners/p1')
  })
})
