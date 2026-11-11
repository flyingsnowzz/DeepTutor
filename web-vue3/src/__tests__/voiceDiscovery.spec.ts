import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hasSpeechModel,
  isListedVoice,
  parseVoiceDiscovery,
  resolveDiscoveryPhase,
  voiceDiscoveryStatus,
  voiceLookupFingerprint,
  type CatalogShape,
} from '../voiceDiscovery'

const apiMock = vi.fn()
vi.mock('../api', () => ({ api: (...args: unknown[]) => apiMock(...args) }))

// Import after the mock is registered so the component binds the stubbed api.
const VoiceDiscoveryField = (await import('../components/VoiceDiscoveryField.vue')).default

function catalogWith(model: Record<string, unknown> = {}): CatalogShape {
  return {
    services: {
      tts: {
        profiles: [
          {
            id: 'p1',
            name: 'Profile',
            connection_id: 'c1',
            base_url: 'https://example.test/v1',
            models: [{ id: 'm1', name: 'Model', model: 'speech-1', ...model }],
          },
        ],
      },
    },
    connections: [{ id: 'c1', api_key: 'secret', binding: 'openai' }],
  }
}

describe('hasSpeechModel', () => {
  it('requires a concrete provider model id', () => {
    expect(hasSpeechModel(catalogWith(), 'p1', 'm1')).toBe(true)
    expect(hasSpeechModel(catalogWith({ model: '   ' }), 'p1', 'm1')).toBe(false)
    expect(hasSpeechModel(catalogWith({ model: '' }), 'p1', 'm1')).toBe(false)
    expect(hasSpeechModel(catalogWith(), 'p1', 'missing')).toBe(false)
    expect(hasSpeechModel(null, 'p1', 'm1')).toBe(false)
  })
})

describe('voiceLookupFingerprint', () => {
  it('stays stable when the selected voice changes', () => {
    const before = voiceLookupFingerprint(catalogWith({ voice: 'a' }), 'p1', 'm1')
    const after = voiceLookupFingerprint(catalogWith({ voice: 'b' }), 'p1', 'm1')
    expect(after).toBe(before)
  })

  it('changes when the provider model id or connection credentials change', () => {
    const base = voiceLookupFingerprint(catalogWith(), 'p1', 'm1')
    const swappedModel = voiceLookupFingerprint(catalogWith({ model: 'speech-2' }), 'p1', 'm1')
    expect(swappedModel).not.toBe(base)
    const rekeyed = catalogWith() as { connections: { api_key: string }[] }
    rekeyed.connections[0].api_key = 'rotated'
    expect(voiceLookupFingerprint(rekeyed, 'p1', 'm1')).not.toBe(base)
  })

  it('ignores cosmetic profile and model display fields', () => {
    const base = voiceLookupFingerprint(catalogWith(), 'p1', 'm1')
    const renamed = catalogWith() as { services: { tts: { profiles: { name: string; models: { name: string }[] }[] } } }
    renamed.services.tts.profiles[0].name = 'Renamed Profile'
    renamed.services.tts.profiles[0].models[0].name = 'Renamed Model'
    expect(voiceLookupFingerprint(renamed, 'p1', 'm1')).toBe(base)
  })
})

describe('parseVoiceDiscovery', () => {
  it('accepts the documented ready/unsupported contract and normalizes rows', () => {
    const parsed = parseVoiceDiscovery({
      status: 'ready',
      scope: 'account',
      voices: [
        { id: 'v1', label: 'Voice One' },
        { id: 'v2', languages: ['zh', 'en'] },
        { id: '   ' },
        'not-an-object',
      ],
    })
    expect(parsed?.voices).toHaveLength(2)
    expect(parsed?.voices[1]?.label).toBe('v2')
    expect(parsed?.voices[1]?.languages).toEqual(['zh', 'en'])
  })

  it('rejects unknown statuses, missing voice arrays, and non-objects', () => {
    expect(parseVoiceDiscovery({ status: 'broken', voices: [] })).toBeNull()
    expect(parseVoiceDiscovery({ status: 'ready' })).toBeNull()
    expect(parseVoiceDiscovery(null)).toBeNull()
    expect(parseVoiceDiscovery('x')).toBeNull()
  })
})

describe('isListedVoice', () => {
  const result = { status: 'ready' as const, scope: 'account' as const, voices: [{ id: 'v1', label: 'V1' }] }
  it('matches only returned ids and never treats empty value as listed', () => {
    expect(isListedVoice(result, 'v1')).toBe(true)
    expect(isListedVoice(result, 'other')).toBe(false)
    expect(isListedVoice(result, '')).toBe(false)
    expect(isListedVoice(null, 'v1')).toBe(false)
  })
})

describe('resolveDiscoveryPhase and status copy', () => {
  const ready = { status: 'ready' as const, scope: 'account' as const, voices: [{ id: 'v', label: 'V' }] }
  it('orders the state machine like the React lookup', () => {
    expect(resolveDiscoveryPhase({ hasModel: false, loading: false, failed: false, result: null })).toBe('model-first')
    expect(resolveDiscoveryPhase({ hasModel: true, loading: true, failed: false, result: null })).toBe('loading')
    expect(resolveDiscoveryPhase({ hasModel: true, loading: false, failed: true, result: null })).toBe('failed')
    expect(resolveDiscoveryPhase({ hasModel: true, loading: false, failed: false, result: { status: 'unsupported', scope: 'none', voices: [] } })).toBe('unsupported')
    expect(resolveDiscoveryPhase({ hasModel: true, loading: false, failed: false, result: { status: 'ready', scope: 'account', voices: [] } })).toBe('empty')
    expect(resolveDiscoveryPhase({ hasModel: true, loading: false, failed: false, result: { status: 'ready', scope: 'custom', voices: ready.voices } })).toBe('custom')
    expect(resolveDiscoveryPhase({ hasModel: true, loading: false, failed: false, result: ready })).toBe('account')
  })

  it('maps every phase to a non-empty Chinese status line', () => {
    for (const phase of ['model-first', 'loading', 'failed', 'unsupported', 'empty', 'custom', 'account', 'public'] as const) {
      expect(voiceDiscoveryStatus(phase).trim().length).toBeGreaterThan(0)
    }
  })
})

describe('VoiceDiscoveryField', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function settle() {
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
  }

  it('shows the model-first hint and never fetches without a provider model id', async () => {
    const catalog = catalogWith({ model: '' })
    const wrapper = mount(VoiceDiscoveryField, {
      props: { catalog, profileId: 'p1', modelId: 'm1', modelValue: '' },
    })
    await settle()
    expect(apiMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请先选择模型')
  })

  it('fetches voices and renders the dropdown with an emit on selection', async () => {
    apiMock.mockResolvedValue({
      status: 'ready',
      scope: 'account',
      voices: [
        { id: 'v1', label: 'Voice One' },
        { id: 'v2', label: 'Voice Two' },
      ],
    })
    const wrapper = mount(VoiceDiscoveryField, {
      props: { catalog: catalogWith(), profileId: 'p1', modelId: 'm1', modelValue: '' },
    })
    await settle()
    expect(apiMock).toHaveBeenCalledTimes(1)
    const call = apiMock.mock.calls[0]
    expect(call[0]).toBe('/api/settings/voice/voices')
    expect(JSON.parse(call[1].body)).toMatchObject({ profile_id: 'p1', model_id: 'm1' })
    const select = wrapper.find('select')
    expect(select.exists()).toBe(true)
    await select.setValue('v2')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['v2'])
  })

  it('surfaces failed state and supports manual refresh', async () => {
    apiMock.mockRejectedValueOnce(new Error('network'))
    const wrapper = mount(VoiceDiscoveryField, {
      props: { catalog: catalogWith(), profileId: 'p1', modelId: 'm1', modelValue: '' },
    })
    await settle()
    expect(wrapper.text()).toContain('音色获取失败')
    await wrapper.find('.voice-discovery-refresh').trigger('click')
    await settle()
    expect(apiMock).toHaveBeenCalledTimes(2)
  })

  it('shows an unlisted current voice and the manual ID editor', async () => {
    apiMock.mockResolvedValue({ status: 'ready', scope: 'account', voices: [{ id: 'v1', label: 'V1' }] })
    const wrapper = mount(VoiceDiscoveryField, {
      props: { catalog: catalogWith(), profileId: 'p1', modelId: 'm1', modelValue: 'custom-voice' },
    })
    await settle()
    expect(wrapper.text()).toContain('当前音色')
    expect(wrapper.text()).toContain('custom-voice')
    await wrapper.find('.voice-discovery-manual-toggle').trigger('click')
    const manual = wrapper.find('.voice-discovery-manual input')
    expect(manual.exists()).toBe(true)
    await manual.setValue('typed-id')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['typed-id'])
  })

  it('renders unsupported providers without a dropdown', async () => {
    apiMock.mockResolvedValue({ status: 'unsupported', scope: 'none', voices: [] })
    const wrapper = mount(VoiceDiscoveryField, {
      props: { catalog: catalogWith(), profileId: 'p1', modelId: 'm1', modelValue: '' },
    })
    await settle()
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).toContain('不支持通过此连接自动获取音色')
  })
})
