import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RuntimeSettingsSection from '../RuntimeSettingsSection.vue'
import { api, post } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)

describe('RuntimeSettingsSection', () => {
  beforeEach(() => { apiMock.mockReset(); postMock.mockReset(); postMock.mockResolvedValue({}) })
  it('creates a workspace with the API name/path payload', async () => {
    apiMock.mockResolvedValue({ workspaces: [{ workspace_id: 'w1', display_name: 'Research', path: '/w1', kind: 'workspace' }] } as any)
    const wrapper = mount(RuntimeSettingsSection, { props: { section: 'workspace' } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text().includes('新建工作区'))!.trigger('click')
    const inputs = wrapper.findAll('form input')
    await inputs[0].setValue('Physics')
    await inputs[1].setValue('/tmp/physics')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/settings/workspace/registrations', { name: 'Physics', path: '/tmp/physics', resources: { skills: null, mcp: null, knowledge_bases: null } })
  })

  it('loads migration workspaces and previews selected feature bundles', async () => {
    apiMock.mockImplementation(async path => {
      if (String(path).includes('/registrations')) return { workspaces: [{ workspace_id: 'w1', display_name: 'Research' }] }
      if (String(path).includes('/discover')) return { transfer_available: true, features: [{ feature: 'reading', files: 2, bytes: 10 }] }
      if (String(path).includes('/operations')) return { operations: [] }
      return {}
    })
    postMock.mockResolvedValue({ blockers: [], features: ['reading'], files: 2, sessions: 1 } as any)
    const wrapper = mount(RuntimeSettingsSection, { props: { section: 'data-migration' } })
    await flushPromises()
    expect(wrapper.find('select').element.value).toBe('w1')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.findAll('button').find(button => button.text() === '预览迁移')!.trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/settings/workspace/data/preview', expect.objectContaining({ source_workspace_id: 'w1', features: ['reading'] }))
    expect(wrapper.findAll('button').find(button => button.text() === '迁移以上数据')!.attributes('disabled')).toBeUndefined()
  })
})
