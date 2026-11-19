import { describe, expect, it } from 'vitest'
import { modelTestFingerprint } from '../modelTestFingerprint'

describe('model test request fingerprint', () => {
  const catalog = () => ({ connections: [{ id: 'connection-a', api_key: 'secret-a' }], services: { llm: {
    profiles: [{ id: 'profile-a', name: 'Display name', connection_id: 'connection-a', models: [{ id: 'model-a', model: 'gpt-test', name: 'Model label' }] }],
  } } })

  it('ignores detected metadata and display names but invalidates changed request inputs', () => {
    const value = catalog()
    const original = modelTestFingerprint(value, 'llm', 'profile-a', 'model-a')
    Object.assign(value.services.llm.profiles[0].models[0], { context_window: '128000', context_window_source: 'metadata', dimension: '1536', name: 'New label' })
    value.services.llm.profiles[0].name = 'New provider label'
    expect(modelTestFingerprint(value, 'llm', 'profile-a', 'model-a')).toBe(original)
    value.connections[0].api_key = 'secret-b'
    expect(modelTestFingerprint(value, 'llm', 'profile-a', 'model-a')).not.toBe(original)
  })

  it('invalidates when a referenced provider profile changes credentials', () => {
    const value = catalog() as ReturnType<typeof catalog> & { services: Record<string, any> }
    value.services.embedding = { profiles: [{ id: 'shared-profile', api_key: 'first-key', base_url: 'https://example.test', models: [] }] }
    Object.assign(value.services.llm.profiles[0].models[0], { provider_ref: { service: 'embedding', profile_id: 'shared-profile' } })
    const original = modelTestFingerprint(value, 'llm', 'profile-a', 'model-a')
    value.services.embedding.profiles[0].api_key = 'second-key'
    expect(modelTestFingerprint(value, 'llm', 'profile-a', 'model-a')).not.toBe(original)
  })
})
