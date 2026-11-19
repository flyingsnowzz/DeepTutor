import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DocumentParsingSettings from '../DocumentParsingSettings.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
const apiMock = vi.mocked(api)
const payload = (engine: string) => ({
  engine, image_description_model: null, engines: { text_only: {} },
  available_engines: [{ id: 'text_only', name: 'Text only', description: '', needs_local_models: false, available: true }],
  readiness: {}, installable: [], mineru: { api_token_set: false },
})

describe('DocumentParsingSettings loading', () => {
  beforeEach(() => apiMock.mockReset())

  it('does not expose editable defaults when the settings payload is invalid', async () => {
    apiMock.mockImplementation(path => String(path).includes('llm-options') ? Promise.resolve({ options: [] }) as never : Promise.resolve(null) as never)
    const wrapper = mount(DocumentParsingSettings, { global: { stubs: { LegacyIcon: true } } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('null')
    expect(wrapper.find('#image-description-model').exists()).toBe(false)
    wrapper.unmount()
  })

  it('ignores a late response from an older revision', async () => {
    let resolveOld!: (value: ReturnType<typeof payload>) => void
    const old = new Promise<ReturnType<typeof payload>>(resolve => { resolveOld = resolve })
    let reads = 0
    apiMock.mockImplementation(path => {
      if (String(path).includes('llm-options')) return Promise.resolve({ options: [] }) as never
      reads += 1
      return (reads === 1 ? old : Promise.resolve(payload('text_only'))) as never
    })
    const wrapper = mount(DocumentParsingSettings, { props: { revision: 0 }, global: { stubs: { LegacyIcon: true } } })
    await wrapper.setProps({ revision: 1 })
    await flushPromises()
    expect(wrapper.emitted('loaded')).toHaveLength(1)
    resolveOld(payload('tika'))
    await flushPromises()
    expect(wrapper.emitted('loaded')).toHaveLength(1)
    wrapper.unmount()
  })
})
