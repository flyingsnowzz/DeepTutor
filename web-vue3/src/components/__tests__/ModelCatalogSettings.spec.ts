import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModelCatalogSettings from '../ModelCatalogSettings.vue'
import { api, post } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const model = { id: 'm1', model: 'gpt-test', name: 'Test model' }
const profile = { id: 'p1', name: 'Provider', provider: 'openai', models: [model] }
const catalog = {
  services: {
    llm: { active_profile_id: 'p1', active_model_id: 'm1', profiles: [profile] },
    task: { active_profile_id: null, active_model_id: null, profiles: [], mode: 'inherit', overrides: {} },
    embedding: { active_profile_id: 'p1', active_model_id: 'm1', profiles: [{ ...profile, id: 'e1', models: [{ id: 'em1', model: 'embed-1' }] }] },
  },
}

describe('ModelCatalogSettings', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset()
    apiMock.mockImplementation(async (path, init) => {
      if (path === '/api/settings') return structuredClone({ catalog, task_kinds: [{ id: 'session_title', group: 'chat' }] })
      if (path === '/api/settings/draft' && !init) return { draft: null }
      return {}
    })
    postMock.mockResolvedValue({})
  })

  it('adds a provider model with its runtime model name and saves a draft', async () => {
    const wrapper = mount(ModelCatalogSettings, { props: { section: 'llm' } })
    await flushPromises()
    await wrapper.get('input[aria-label="新模型 ID"]').setValue('gpt-new')
    await wrapper.findAll('button').filter(button => button.text() === '添加模型').at(-1)!.trigger('click')
    await wrapper.get('button.primary').trigger('click')
    await flushPromises()
    const draft = apiMock.mock.calls.find(call => call[0] === '/api/settings/draft' && call[1]?.method === 'PUT')
    const body = JSON.parse(String(draft?.[1]?.body))
    expect(body.catalog.services.llm.profiles[0].models.at(-1)).toMatchObject({ id: 'gpt-new', model: 'gpt-new' })
    expect(postMock).toHaveBeenCalledWith('/api/settings/apply/service', expect.objectContaining({ service: 'llm' }))
  })

  it('stores global and per-task choices using the backend contract', async () => {
    const wrapper = mount(ModelCatalogSettings, { props: { section: 'task-models' } })
    await flushPromises()
    await wrapper.get('select[aria-label="后台任务模型"]').setValue('llm:p1:m1')
    await wrapper.get('select[aria-label="session_title 任务模型"]').setValue('llm:p1:m1')
    await wrapper.get('button.primary').trigger('click')
    await flushPromises()
    const apply = postMock.mock.calls.find(call => call[0] === '/api/settings/apply/service')
    const config = (apply?.[1] as any).config
    expect(config).toMatchObject({ mode: 'reference', selection: { profile_id: 'p1', model_id: 'm1' } })
    expect(config.overrides.session_title).toEqual({ mode: 'reference', selection: { profile_id: 'p1', model_id: 'm1' } })
    await wrapper.get('select[aria-label="session_title 任务模型"]').setValue('global')
    expect(config.overrides.session_title).toBeUndefined()
  })

  it('explains when a deployment does not return a personal catalog', async () => {
    apiMock.mockImplementation(async path => path === '/api/settings' ? { ui: {} } : { draft: null })
    const wrapper = mount(ModelCatalogSettings, { props: { section: 'llm' } })
    await flushPromises()
    expect(wrapper.text()).toContain('你可以添加自己的模型')
    expect(wrapper.find('button.primary').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
})
