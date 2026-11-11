import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AgentsPage from '../AgentsPage.vue'
import { api } from '../../api'
import { buildSelectGroups, parseSessions, pickAndScan } from '../../imports/chat-import'
import { getAgents, newAgentId, saveAgent } from '../../imports/chat-import/agent-store'
import { importChatHistoryInBatches } from '../../imports/importApi'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
vi.mock('../../imports/chat-import', () => ({
  buildSelectGroups: vi.fn(() => [{ key: '/demo', label: 'demo', sessions: [{ externalId: 's1', cwd: '/demo' }] }]),
  filterRefsByScope: vi.fn(refs => refs),
  isFileSystemAccessSupported: vi.fn(() => true),
  parseSessions: vi.fn(),
  pickAndScan: vi.fn(),
  scanDirectory: vi.fn(),
  selectionUnit: vi.fn(() => 'projects'),
}))
vi.mock('../../imports/chat-import/agent-store', () => ({
  deleteAgent: vi.fn(), ensureReadPermission: vi.fn(() => true), getAgents: vi.fn(() => []), newAgentId: vi.fn(() => 'claude_code-agent1'), saveAgent: vi.fn(),
}))
vi.mock('../../imports/importApi', () => ({ importChatHistoryInBatches: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const scan = { source: 'claude_code', handle: { name: '.claude' }, projects: [] }

describe('AgentsPage', () => {
  beforeEach(() => {
    apiMock.mockReset(); vi.mocked(saveAgent).mockClear(); vi.mocked(newAgentId).mockClear()
    let savedAgent: any = null
    vi.mocked(saveAgent).mockImplementation(async agent => { savedAgent = agent })
    vi.mocked(getAgents).mockImplementation(async () => savedAgent ? [savedAgent] : [])
    vi.mocked(pickAndScan).mockResolvedValue(scan as any)
    vi.mocked(parseSessions).mockResolvedValue([{ external_id: 's1', title: 'Hello', source_cwd: '/demo', created_at: 1, updated_at: 1, messages: [{ role: 'user', content: 'Hello' }] }])
    vi.mocked(importChatHistoryInBatches).mockResolvedValue({ imported: 1, skipped: 0, sessions: [] })
    apiMock.mockImplementation(async path => {
      if (path === '/api/subagents/detect') return { backends: [] }
      if (path === '/api/subagents/connections') return { connections: [] }
      if (String(path).startsWith('/api/imports/chat-history')) return {
        sessions: [{
          id: 's1', title: 'Hello', created_at: 1, updated_at: 1,
          preferences: { import: { source: 'claude_code', source_cwd: '/demo', agent_id: 'claude_code-agent1' } },
        }],
      }
      return {}
    })
  })

  it('scans a folder and imports the selected project into an agent', async () => {
    const wrapper = mount(AgentsPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '导入对话')?.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '选择 .claude 或 .codex 目录')?.trigger('click')
    await flushPromises()
    await wrapper.get('input[placeholder="例如：我的 Claude"]').setValue('My Claude')
    await wrapper.findAll('button').find(button => button.text() === '开始导入')?.trigger('click')
    await flushPromises()
    expect(parseSessions).toHaveBeenCalledWith('claude_code', [{ externalId: 's1', cwd: '/demo' }], expect.any(Function))
    expect(importChatHistoryInBatches).toHaveBeenCalledWith('claude_code', [expect.objectContaining({ external_id: 's1' })], { id: 'claude_code-agent1', name: 'My Claude' }, expect.any(Function))
    expect(saveAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude_code-agent1', scope: { kind: 'all' } }))
    expect(wrapper.text()).toContain('导入 1 段新对话')
    expect(wrapper.text()).toContain('My Claude')
  })

  it('renames an imported conversation inline instead of opening a prompt', async () => {
    vi.mocked(getAgents).mockResolvedValue([{ id: 'claude_code-agent1', name: 'My Claude', source: 'claude_code', folderName: '.claude', handle: null, scope: { kind: 'all' }, createdAt: 1, lastSyncAt: 1 } as any])
    const wrapper = mount(AgentsPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('button[aria-label="重命名对话"]').trigger('click')
    const input = wrapper.get('input[aria-label="对话标题"]')
    expect(input.element).toBeTruthy()
    await input.setValue('Renamed conversation')
    await input.trigger('keyup.enter')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/sessions/s1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ title: 'Renamed conversation' }) }))
  })

})
