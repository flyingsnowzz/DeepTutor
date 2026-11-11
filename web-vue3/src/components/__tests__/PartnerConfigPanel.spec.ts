import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PartnerConfigPanel from '../PartnerConfigPanel.vue'
import { api, post } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)

describe('PartnerConfigPanel', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset()
    apiMock.mockImplementation(async path => {
      if (path === '/api/partners/p1/soul') return { content: 'Original soul' }
      if (path === '/api/settings/llm-options') return { options: [{ profile_id: 'default', model_id: 'chat', profile_name: 'Default', model_name: 'Chat' }] }
      if (path === '/api/partners/tool-options') return { tools: [{ name: 'web_search' }], builtin_tools: [{ name: 'rag' }], mcp_tools: [] }
      if (path === '/api/partners/p1/assets') return { knowledge_bases: [], skills: [], notebooks: [] }
      if (path === '/api/knowledge-bases/list') return []
      if (path === '/api/skills/list') return { skills: [] }
      if (path === '/api/notebooks') return { notebooks: [] }
      if (path === '/api/partners/channels/schema') return {
        channels: {
          telegram: {
            display_name: 'Telegram', default_config: { enabled: false }, secret_fields: ['token'],
            json_schema: { properties: { token: { type: 'string', title: 'Token' } } },
          },
        },
      }
      if (path === '/api/partners/p1/links') return { links: [] }
      if (path === '/api/partners/p1/channels/status') return { channels: {} }
      if (String(path).startsWith('/api/partners/p1?include_secrets')) return { channels: { telegram: { enabled: false, token: 'secret' } } }
      return {}
    })
  })

  it('saves soul, model and tool configuration independently', async () => {
    const wrapper = mount(PartnerConfigPanel, { props: { partnerId: 'p1', section: 'soul' } })
    await flushPromises()
    await wrapper.get('textarea').setValue('Updated soul')
    await wrapper.get('.partner-soul-card .partner-config-save').trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/partners/p1/soul', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ content: 'Updated soul' }) }))
    await wrapper.findAll('.partner-config-card')[2].get('.partner-config-save').trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/partners/p1', expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"enabled_tools":["web_search"]') }))
  })

  it('saves schema-driven channel configuration without legacy delivery flags', async () => {
    const wrapper = mount(PartnerConfigPanel, { props: { partnerId: 'p1', section: 'channels' } })
    await flushPromises()
    await wrapper.get('input[type="password"]').setValue('new-secret')
    await wrapper.get('.partner-channels-save-row .partner-config-save').trigger('click')
    await flushPromises()
    const patch = apiMock.mock.calls.find(call => call[0] === '/api/partners/p1' && call[1]?.method === 'PATCH')
    expect(JSON.parse(String(patch?.[1]?.body)).channels.telegram.token).toBe('new-secret')
  })
})
