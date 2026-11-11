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
    }))
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
})
