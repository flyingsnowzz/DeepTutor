import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModelCatalogSettings from '../ModelCatalogSettings.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))
const apiMock = vi.mocked(api)
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
    apiMock.mockReset()
    apiMock.mockImplementation(async (path, init) => {
      if (path === '/api/settings') return structuredClone({ catalog, task_kinds: [{ id: 'session_title', group: 'chat' }] })
      if (path === '/api/settings/draft' && !init) return { draft: null }
      return {}
    })
  })

  it('adds a provider model with its runtime model name to the shared draft', async () => {
    const wrapper = mount(ModelCatalogSettings, { props: { section: 'llm' } })
    await flushPromises()
    await wrapper.get('input[aria-label="新模型 ID"]').setValue('gpt-new')
    await wrapper.findAll('button').filter(button => button.text() === '添加模型').at(-1)!.trigger('click')
    await flushPromises()
    const staged = wrapper.emitted('catalogChanged')?.at(-1)?.[0] as typeof catalog
    expect(staged.services.llm.profiles[0].models.at(-1)).toMatchObject({ id: 'gpt-new', model: 'gpt-new' })
    expect(apiMock.mock.calls.some(call => call[0] === '/api/settings/draft' && call[1]?.method === 'PUT')).toBe(false)
  })

  it('stores global and per-task choices using the backend contract', async () => {
    const wrapper = mount(ModelCatalogSettings, { props: { section: 'task-models' } })
    await flushPromises()
    await wrapper.get('select[aria-label="后台任务模型"]').setValue('llm:p1:m1')
    await wrapper.get('select[aria-label="对话标题"]').setValue('llm:p1:m1')
    const config = (wrapper.emitted('catalogChanged')?.at(-1)?.[0] as any).services.task
    expect(config).toMatchObject({ mode: 'reference', selection: { profile_id: 'p1', model_id: 'm1' } })
    expect(config.overrides.session_title).toEqual({ mode: 'reference', selection: { profile_id: 'p1', model_id: 'm1' } })
    await wrapper.get('select[aria-label="对话标题"]').setValue('global')
    const updated = (wrapper.emitted('catalogChanged')?.at(-1)?.[0] as any).services.task
    expect(updated.overrides).toBeUndefined()
  })

  it('groups and names tasks like the legacy workspace without a per-task chat-model option', async () => {
    apiMock.mockImplementation(async path => {
      if (path === '/api/settings') return structuredClone({
        catalog,
        task_kinds: [
          { id: 'session_title', group: 'chat' },
          { id: 'chat_starters', group: 'chat' },
          { id: 'reading_translation', group: 'reading' },
          { id: 'reading_future_task', group: 'reading' },
        ],
      })
      return { draft: null }
    })
    const wrapper = mount(ModelCatalogSettings, { props: { section: 'task-models', language: 'en' } })
    await flushPromises()
    const headings = wrapper.findAll('.task-setting-section-header h2').map(node => node.text())
    expect(headings).toEqual(['Global task model', 'Conversation', 'Immersive reading'])
    expect(wrapper.text()).toContain('Names a conversation from its opening exchange.')
    expect(wrapper.text()).toContain('Translates a passage you selected while reading.')
    expect(wrapper.find('select[aria-label="reading_future_task"]').exists()).toBe(true)
    const options = wrapper.get('select[aria-label="Conversation titles"]').findAll('option')
    expect(options.map(option => option.text())).toEqual(['Follow the global task model', 'Test model · Provider'])
    expect(wrapper.find('.task-models-workspace .model-editor-card').exists()).toBe(false)
  })

  it('restores legacy task profile selections and reports unavailable pins without rewriting them', async () => {
    const legacy = structuredClone(catalog) as any
    legacy.services.task = {
      active_profile_id: 'cheap',
      active_model_id: 'mini',
      profiles: [{ id: 'cheap', name: 'Task account', models: [{ id: 'mini', model: 'model-mini' }] }],
      overrides: {
        session_title: { mode: 'profiles', active_profile_id: 'cheap', active_model_id: 'deleted' },
      },
    }
    apiMock.mockImplementation(async path => path === '/api/settings'
      ? structuredClone({ catalog: legacy, task_kinds: [{ id: 'session_title', group: 'chat' }] })
      : { draft: null })
    const wrapper = mount(ModelCatalogSettings, { props: { section: 'task-models', language: 'en' } })
    await flushPromises()
    expect((wrapper.get('select[aria-label="Background task model"]').element as HTMLSelectElement).value).toBe('task:cheap:mini')
    const override = wrapper.get('select[aria-label="Conversation titles"]')
    expect((override.element as HTMLSelectElement).value).toBe('global')
    const unavailable = override.find('option[disabled]')
    expect(unavailable.text()).toBe('Selected model is unavailable — choose another')
    expect(wrapper.emitted('catalogChanged')).toBeUndefined()
  })

  it('links to language models when none are configured and disables choices while applying', async () => {
    const empty = structuredClone(catalog) as any
    empty.services.llm.profiles = []
    empty.services.task.profiles = []
    apiMock.mockImplementation(async path => path === '/api/settings'
      ? structuredClone({ catalog: empty, task_kinds: [{ id: 'session_title', group: 'chat' }] })
      : { draft: null })
    const wrapper = mount(ModelCatalogSettings, {
      props: { section: 'task-models', language: 'en', applying: true },
      global: { stubs: { RouterLink: { template: '<a href="/settings/llm"><slot /></a>' } } },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('No models configured yet.')
    expect(wrapper.get('.task-models-empty a').attributes('href')).toBe('/settings/llm')
    expect(wrapper.findAll('.task-model-select').every(node => node.attributes('disabled') !== undefined)).toBe(true)
  })

  it('shows the legacy administrator-only message on task models without a personal catalog', async () => {
    apiMock.mockImplementation(async path => path === '/api/settings' ? { ui: {} } : { draft: null })
    const wrapper = mount(ModelCatalogSettings, { props: { section: 'task-models', language: 'en' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Only administrators can manage models.')
    expect(wrapper.findAll('.task-model-select')).toHaveLength(0)
    expect(wrapper.find('.task-models-workspace').exists()).toBe(false)
  })

  it('explains when a deployment does not return a personal catalog', async () => {
    apiMock.mockImplementation(async path => path === '/api/settings' ? { ui: {} } : { draft: null })
    const wrapper = mount(ModelCatalogSettings, { props: { section: 'llm' } })
    await flushPromises()
    expect(wrapper.text()).toContain('你可以添加自己的模型')
    expect(wrapper.find('button.primary').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('keeps the newest catalog when an earlier load resolves late', async () => {
    let resolveOld!: (value: unknown) => void
    const old = new Promise(resolve => { resolveOld = resolve })
    let reads = 0
    const fresh = structuredClone(catalog)
    fresh.services.llm.profiles[0].models = [{ id: 'm2', model: 'gpt-fresh', name: 'Fresh model' }]
    apiMock.mockImplementation(path => {
      if (path === '/api/settings/draft') return Promise.resolve({ draft: null }) as never
      reads += 1
      return (reads === 1 ? old : Promise.resolve({ catalog: fresh, task_kinds: [] })) as never
    })
    const wrapper = mount(ModelCatalogSettings, { props: { section: 'llm', revision: 0 } })
    await wrapper.setProps({ revision: 1 })
    await flushPromises()
    expect(wrapper.text()).toContain('Fresh model')
    resolveOld({ catalog, task_kinds: [] })
    await flushPromises()
    expect(wrapper.text()).toContain('Fresh model')
    expect(wrapper.text()).not.toContain('Test model')
    wrapper.unmount()
  })

  it('shows loading instead of a missing-catalog message before the first response', async () => {
    let resolveSettings!: (value: unknown) => void
    const settings = new Promise(resolve => { resolveSettings = resolve })
    apiMock.mockImplementation(path => path === '/api/settings' ? settings as never : Promise.resolve({ draft: null }) as never)
    const wrapper = mount(ModelCatalogSettings, { props: { section: 'llm' } })
    expect(wrapper.text()).toContain('加载模型目录中')
    expect(wrapper.text()).not.toContain('未返回可编辑的个人模型目录')
    resolveSettings({ catalog, task_kinds: [] })
    await flushPromises()
    expect(wrapper.text()).toContain('Test model')
    wrapper.unmount()
  })
})
