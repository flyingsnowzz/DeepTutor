import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceSettings from '../WorkspaceSettings.vue'
import { api, post } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const catalog = { root: '/data', workspaces: [] }

describe('WorkspaceSettings loading', () => {
  beforeEach(() => { apiMock.mockReset(); postMock.mockReset() })

  it('does not render storage controls when the catalog fails to load', async () => {
    apiMock.mockRejectedValue(new Error('offline'))
    const wrapper = mount(WorkspaceSettings)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('offline')
    expect(wrapper.find('.workspace-root-form').exists()).toBe(false)
    expect(wrapper.get('.workspace-page-heading button').attributes('disabled')).toBeDefined()
  })

  it('does not report success when a create action succeeds but refresh fails', async () => {
    let catalogReads = 0
    apiMock.mockImplementation(path => {
      if (path === '/api/settings/workspace/registrations') {
        catalogReads++
        return catalogReads === 1 ? Promise.resolve(catalog) as never : Promise.reject(new Error('refresh failed')) as never
      }
      return Promise.resolve({ skills: [], mcp: [], knowledge_bases: [] }) as never
    })
    postMock.mockResolvedValue({})
    const wrapper = mount(WorkspaceSettings)
    await flushPromises()
    await wrapper.get('.workspace-page-heading button').trigger('click')
    await wrapper.get('input[maxlength="100"]').setValue('Math')
    await wrapper.get('.workspace-create-form').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('refresh failed')
    expect(wrapper.text()).not.toContain('工作区已更新')
  })
})
