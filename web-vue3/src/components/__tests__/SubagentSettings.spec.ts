import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SubagentSettings from '../SubagentSettings.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))

describe('SubagentSettings', () => {
  it('loads backend options and saves only the edited backend', async () => {
    const apiMock = vi.mocked(api)
    apiMock.mockImplementation(async path => {
      if (path === '/api/subagents/backends/options') return { backends: [{ kind: 'codex', display_name: 'Codex', available: true, models: [{ slug: 'gpt-test', display_name: 'GPT Test', efforts: ['high'] }], efforts: ['high'] }] }
      if (path === '/api/subagents/settings') return { backends: { codex: { model: '', effort: '' } } }
      if (path === '/api/auth/status') return { is_admin: true }
      return {}
    })
    const wrapper = mount(SubagentSettings, { props: { kind: 'codex' } })
    await flushPromises()
    await wrapper.get('select[aria-label="智能体模型"]').setValue('gpt-test')
    await wrapper.get('select[aria-label="智能体推理强度"]').setValue('high')
    await wrapper.get('button.primary').trigger('click')
    await flushPromises()
    const put = apiMock.mock.calls.find(call => call[0] === '/api/subagents/settings' && call[1]?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body)).backends.codex).toMatchObject({ model: 'gpt-test', effort: 'high' })
  })
})
