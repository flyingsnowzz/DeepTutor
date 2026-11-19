import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProviderModelDiscovery from '../ProviderModelDiscovery.vue'
import { post } from '../../api'

vi.mock('../../api', () => ({ post: vi.fn() }))
const postMock = vi.mocked(post)

const input = { binding: 'openai', base_url: 'https://api.example.com/v1', api_key: 'sk-test', service: 'llm' as const }

describe('ProviderModelDiscovery', () => {
  beforeEach(() => postMock.mockReset())

  it('probes the provider and emits the chosen model in single-select mode', async () => {
    postMock.mockResolvedValue({ status: 'connected', models: [{ id: 'gpt-a' }, { id: 'gpt-b' }] })
    const wrapper = mount(ProviderModelDiscovery, { props: { input } })
    await wrapper.get('button.provider-discovery-btn').trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/settings/test-provider', expect.objectContaining({
      binding: 'openai', base_url: 'https://api.example.com/v1', service: 'llm', profile_id: null,
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(wrapper.text()).toContain('连接成功')
    await wrapper.get('select.provider-discovery-select').setValue('gpt-b')
    expect(wrapper.emitted('pick')?.[0]).toEqual(['gpt-b'])
  })

  it('multi-select mode adds only newly selected models and skips existing ones', async () => {
    postMock.mockResolvedValue({ status: 'connected', models: [{ id: 'gpt-a' }, { id: 'gpt-b' }, { id: 'gpt-c' }] })
    const wrapper = mount(ProviderModelDiscovery, { props: { input, pickMany: true, selectedModels: ['gpt-a'] } })
    await wrapper.get('button.provider-discovery-btn').trigger('click')
    await flushPromises()
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    // gpt-a is already added and therefore disabled
    expect((checkboxes[0].element as HTMLInputElement).disabled).toBe(true)
    await checkboxes[1].setValue(true)
    await checkboxes[2].setValue(true)
    await wrapper.get('button.provider-discovery-add').trigger('click')
    expect(wrapper.emitted('pickMany')?.[0]).toEqual([['gpt-b', 'gpt-c']])
  })

  it('surfaces failure status messages without a model picker', async () => {
    postMock.mockResolvedValue({ status: 'auth_error', models: [] })
    const wrapper = mount(ProviderModelDiscovery, { props: { input } })
    await wrapper.get('button.provider-discovery-btn').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('凭据')
    expect(wrapper.find('.provider-discovery-picker').exists()).toBe(false)
  })

  it('disables the probe button until a base URL is present', () => {
    const wrapper = mount(ProviderModelDiscovery, { props: { input: { ...input, base_url: '' } } })
    expect((wrapper.get('button.provider-discovery-btn').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('aborts an old probe and enables retry after credentials change', async () => {
    let resolveOld!: (value: { status: string; models: { id: string }[] }) => void
    postMock.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }) as ReturnType<typeof post>)
    postMock.mockResolvedValueOnce({ status: 'connected', models: [{ id: 'new-model' }] })
    const wrapper = mount(ProviderModelDiscovery, { props: { input } })
    await wrapper.get('button.provider-discovery-btn').trigger('click')
    const oldSignal = postMock.mock.calls[0][2]?.signal as AbortSignal
    expect(oldSignal.aborted).toBe(false)
    await wrapper.setProps({ input: { ...input, api_key: 'new-key' } })
    expect(oldSignal.aborted).toBe(true)
    expect((wrapper.get('button.provider-discovery-btn').element as HTMLButtonElement).disabled).toBe(false)
    await wrapper.get('button.provider-discovery-btn').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('new-model')
    resolveOld({ status: 'connected', models: [{ id: 'old-model' }] })
    await flushPromises()
    expect(wrapper.text()).not.toContain('old-model')
  })

  it('shows English probe status and picker actions', async () => {
    postMock.mockResolvedValue({ status: 'connected', models: [{ id: 'model-a' }, { id: 'model-b' }] })
    const wrapper = mount(ProviderModelDiscovery, { props: { input, pickMany: true, language: 'en' } })
    await wrapper.get('button.provider-discovery-btn').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Connected. The provider returned 2 models.')
    expect(wrapper.text()).toContain('Add selected models')
    expect(wrapper.get('[role="group"]').attributes('aria-label')).toBe('Choose a model from this provider')
  })

  it('shows saved connection discovery with capability evidence and HTTP details', async () => {
    const wrapper = mount(ProviderModelDiscovery, { props: {
      input, connectionMode: true, language: 'en', hints: ['llm'],
      discovery: { status: 'http_error', models: [], http_status: 502, warning: 'partial_models', capabilities: [{ category: 'embedding', evidence: 'metadata' }] },
    } })
    expect(wrapper.text()).toContain('HTTP 502')
    expect(wrapper.text()).toContain('Only some models were listed')
    expect(wrapper.text()).toContain('Embedding modelsDetected')
    expect(wrapper.text()).toContain('Language modelsProvider supports')
    expect(wrapper.find('.provider-discovery-picker').exists()).toBe(false)
  })
})
