import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../providerAuth', () => ({
  isLoopbackHostname: vi.fn(() => true),
  buildSshForwardCommand: vi.fn(() => 'ssh -N -L 1:127.0.0.1:2 u@h'),
  shouldPollCodexStatus: vi.fn((s: { operation_state: string | null }) =>
    ['waiting', 'exchanging', 'fetching_models'].includes(s.operation_state ?? '')),
  shouldPollCodeBuddyAuth: vi.fn((s: { operation_state: string | null }) => s.operation_state === 'waiting'),
  getCodexStatus: vi.fn(),
  startCodexLogin: vi.fn(),
  cancelCodexLogin: vi.fn(),
  completeCodexLogin: vi.fn(),
  refreshCodexModels: vi.fn(),
  setCodexReasoningEffort: vi.fn(),
  logoutCodex: vi.fn(),
  codexErrorMessage: vi.fn((code: string | null, fb?: string) => fb || 'Codex 请求失败'),
  codexStatusMessage: vi.fn(() => '已连接。'),
  CodexOAuthApiError: class extends Error {},
  getCodeBuddyStatus: vi.fn(),
  startCodeBuddyLogin: vi.fn(),
  cancelCodeBuddyLogin: vi.fn(),
  logoutCodeBuddy: vi.fn(),
}))

import CodexOAuthCard from '../CodexOAuthCard.vue'
import CodeBuddyAuthCard from '../CodeBuddyAuthCard.vue'
import * as auth from '../../providerAuth'
import type { CodexOAuthStatus, CodeBuddyAuthStatus } from '../../providerAuth'

const codexConnected: CodexOAuthStatus = {
  connection: 'connected', operation_id: null, operation_state: null, authorize_url: null,
  expires_in: null, callback_port: null, callback_forward_port: null, redirect_uri: null,
  model_count: 2, catalog_source: 'live', catalog_fetched_at: null, active_model: 'gpt-codex',
  activated: true, error_code: null,
  models: [{ model: 'gpt-codex', name: 'GPT Codex', supported_reasoning_levels: ['low', 'high'], reasoning_effort: 'low' }],
}
const codexDisconnected: CodexOAuthStatus = {
  ...codexConnected, connection: 'disconnected', activated: false, active_model: null, model_count: 0, models: [],
}

describe('CodexOAuthCard', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('open', vi.fn()) })

  it('renders connected state with model count and a reasoning selector', async () => {
    vi.mocked(auth.getCodexStatus).mockResolvedValue({ ...codexConnected })
    const wrapper = mount(CodexOAuthCard)
    await flushPromises()
    expect(wrapper.text()).toContain('已连接')
    expect(wrapper.text()).toContain('已导入 2 个模型')
    expect(wrapper.find('select[aria-label="推理强度"]').exists()).toBe(true)
    expect(wrapper.find('button.primary').exists()).toBe(false)
  })

  it('starts a local sign-in flow when disconnected', async () => {
    vi.mocked(auth.getCodexStatus).mockResolvedValue({ ...codexDisconnected })
    vi.mocked(auth.startCodexLogin).mockResolvedValue({
      operation_id: 'op1', authorize_url: 'https://provider/auth', expires_in: 300,
      callback_port: 1455, callback_forward_port: 1455, redirect_uri: 'http://127.0.0.1:1455/cb', ssh_forward_command: '',
    })
    const wrapper = mount(CodexOAuthCard)
    await flushPromises()
    const signIn = wrapper.findAll('button').find(b => b.text().includes('登录 Codex'))
    expect(signIn).toBeTruthy()
    await signIn!.trigger('click')
    await flushPromises()
    expect(auth.startCodexLogin).toHaveBeenCalledTimes(1)
    expect(window.open).toHaveBeenCalled()
  })

  it('logs out and emits catalogChanged when connected', async () => {
    vi.mocked(auth.getCodexStatus).mockResolvedValue({ ...codexConnected })
    vi.mocked(auth.logoutCodex).mockResolvedValue({ ...codexDisconnected })
    const wrapper = mount(CodexOAuthCard)
    await flushPromises()
    const logout = wrapper.findAll('button').find(b => b.text().includes('退出登录'))
    await logout!.trigger('click')
    await flushPromises()
    expect(auth.logoutCodex).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('catalogChanged')).toBeTruthy()
  })
})

describe('CodeBuddyAuthCard', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('open', vi.fn()) })

  it('renders the disconnected sign-in action and starts login', async () => {
    vi.mocked(auth.getCodeBuddyStatus).mockResolvedValue({
      connection: 'disconnected' as const, operation_state: null, authorize_url: null, user_label: null, error_code: null,
    })
    vi.mocked(auth.startCodeBuddyLogin).mockResolvedValue({
      connection: 'authorizing' as const, operation_state: 'waiting', authorize_url: 'https://cb/auth', user_label: null, error_code: null,
    })
    const wrapper = mount(CodeBuddyAuthCard)
    await flushPromises()
    expect(wrapper.text()).toContain('尚未连接')
    const signIn = wrapper.findAll('button').find(b => b.text().includes('登录 CodeBuddy'))
    await signIn!.trigger('click')
    await flushPromises()
    expect(auth.startCodeBuddyLogin).toHaveBeenCalledTimes(1)
  })

  it('shows the connected user and supports logout', async () => {
    vi.mocked(auth.getCodeBuddyStatus).mockResolvedValue({
      connection: 'connected' as const, operation_state: null, authorize_url: null, user_label: 'dev@example.com', error_code: null,
    })
    vi.mocked(auth.logoutCodeBuddy).mockResolvedValue({
      connection: 'disconnected' as const, operation_state: null, authorize_url: null, user_label: null, error_code: null,
    })
    const wrapper = mount(CodeBuddyAuthCard)
    await flushPromises()
    expect(wrapper.text()).toContain('dev@example.com')
    const logout = wrapper.findAll('button').find(b => b.text().includes('退出登录'))
    await logout!.trigger('click')
    await flushPromises()
    expect(auth.logoutCodeBuddy).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('catalogChanged')).toBeTruthy()
  })
})
