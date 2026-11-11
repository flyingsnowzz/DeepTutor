/**
 * Provider OAuth/auth helpers — Vue3 port of web/lib/codex-oauth.ts and
 * web/lib/codebuddy-auth.ts. Backend contracts live in
 * deeptutor/api/routers/settings.py (openai-codex/oauth/*, codebuddy/auth/*).
 */
import { api } from './api'

export type CodexReasoningModel = {
  model: string
  name: string
  supported_reasoning_levels: string[]
  reasoning_effort: string | null
}

export type CodexOAuthStatus = {
  connection: 'disconnected' | 'authorizing' | 'connected' | 'error'
  operation_id: string | null
  operation_state:
    | 'waiting' | 'exchanging' | 'fetching_models'
    | 'completed' | 'cancelled' | 'expired' | 'failed' | null
  authorize_url: string | null
  expires_in: number | null
  callback_port: number | null
  callback_forward_port: number | null
  redirect_uri: string | null
  model_count: number
  catalog_source: 'live' | 'fresh-cache' | 'revalidated-cache' | 'stale-cache' | null
  catalog_fetched_at: number | null
  active_model: string | null
  models: CodexReasoningModel[]
  activated: boolean
  error_code: string | null
}

export type CodexLoginStart = {
  operation_id: string
  authorize_url: string
  expires_in: number
  callback_port: number
  callback_forward_port: number
  redirect_uri: string
  ssh_forward_command: string
}

export type CodeBuddyAuthStatus = {
  connection: 'disconnected' | 'authorizing' | 'connected' | 'error'
  operation_state: 'waiting' | 'completed' | 'cancelled' | 'failed' | null
  authorize_url: string | null
  user_label: string | null
  error_code: string | null
}

export class CodexOAuthApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CodexOAuthApiError'
    this.code = code
  }
}

const CODEX_BASE = '/api/settings/providers/openai-codex'
const CODEBUDDY_BASE = '/api/settings/providers/codebuddy/auth'

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    normalized === '[::1]'
  ) {
    return true
  }
  const octets = normalized.split('.')
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every(octet => /^\d+$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255)
  )
}

export function buildSshForwardCommand(callbackPort: number, hostname: string, forwardPort: number): string {
  const serverHost = hostname.trim() || '<server-host>'
  return `ssh -N -L ${callbackPort}:127.0.0.1:${forwardPort} <ssh-user>@${serverHost}`
}

async function requestCodex<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  try {
    return await api<T>(`${CODEX_BASE}${path}`, {
      method,
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    })
  } catch (cause) {
    // The api() helper surfaces backend detail strings; keep a stable code when available.
    const code = cause instanceof Error && /codex|oauth|catalog|callback|login|denied|timeout/i.test(cause.message)
      ? 'request_detail'
      : `http_${(cause as { status?: number }).status ?? 0}`
    throw new CodexOAuthApiError(code, cause instanceof Error ? cause.message : 'Codex request failed.')
  }
}

export const getCodexStatus = (): Promise<CodexOAuthStatus> => requestCodex('/oauth/status', 'GET')
export const startCodexLogin = (): Promise<CodexLoginStart> => requestCodex('/oauth/start', 'POST')
export const cancelCodexLogin = (): Promise<CodexOAuthStatus> => requestCodex('/oauth/cancel', 'POST')
export const completeCodexLogin = (callbackUrl: string): Promise<CodexOAuthStatus> =>
  requestCodex('/oauth/complete', 'POST', { callback_url: callbackUrl })
export const refreshCodexModels = (): Promise<CodexOAuthStatus> => requestCodex('/models/refresh', 'POST')
export const setCodexReasoningEffort = (model: string, reasoningEffort: string | null): Promise<CodexOAuthStatus> =>
  requestCodex('/models/reasoning-effort', 'POST', { model, reasoning_effort: reasoningEffort })
export const logoutCodex = (): Promise<CodexOAuthStatus> => requestCodex('/oauth/logout', 'POST')

export function shouldPollCodexStatus(status: CodexOAuthStatus): boolean {
  return (
    status.operation_state === 'waiting' ||
    status.operation_state === 'exchanging' ||
    status.operation_state === 'fetching_models'
  )
}

const ERROR_MESSAGES: Record<string, string> = {
  catalog_unavailable: '模型目录不可用，请稍后重试。',
  catalog_invalid: '模型目录无效，请检查 Codex 配置。',
  inference_in_progress: '当前有推理任务进行中，请完成后再操作。',
  login_timeout: '等待登录回调超时，请重新发起登录。',
  callback_unavailable: '本地回调服务不可用（容器环境请使用回调地址粘贴方式）。',
  callback_url_invalid: '回调地址无效，请粘贴浏览器跳转后的完整地址。',
  invalid_response: 'DeepTutor 返回了无效的 Codex OAuth 响应。',
  reasoning_effort_unsupported: '该模型不支持所选推理强度。',
  codex_model_not_found: '模型目录已变化，未找到该 Codex 模型。',
  codex_catalog_unavailable: '模型目录已变化且当前不可用。',
  login_cancelled: '登录已取消。',
  authorization_denied: '授权被拒绝。',
  request_detail: 'Codex 请求失败。',
}

export function codexErrorMessage(code: string | null, fallback?: string): string {
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]
  return fallback || 'Codex 请求失败，请稍后重试。'
}

export function codexStatusMessage(status: CodexOAuthStatus): string {
  if (status.error_code) return codexErrorMessage(status.error_code)
  if (shouldPollCodexStatus(status)) return '等待浏览器完成授权…'
  if (status.activated && status.active_model) return `已连接，当前模型：${status.active_model}`
  if (status.connection === 'connected') return '已连接。'
  if (status.operation_state === 'cancelled') return '登录已取消。'
  if (status.operation_state === 'expired') return '登录已过期，请重新发起。'
  return '尚未连接。'
}

async function codebuddyRequest<T>(path: string, method: 'GET' | 'POST'): Promise<T> {
  return api<T>(`${CODEBUDDY_BASE}${path}`, { method })
}

export const getCodeBuddyStatus = (): Promise<CodeBuddyAuthStatus> => codebuddyRequest('/status', 'GET')
export const startCodeBuddyLogin = (): Promise<CodeBuddyAuthStatus> => codebuddyRequest('/start', 'POST')
export const cancelCodeBuddyLogin = (): Promise<CodeBuddyAuthStatus> => codebuddyRequest('/cancel', 'POST')
export const logoutCodeBuddy = (): Promise<CodeBuddyAuthStatus> => codebuddyRequest('/logout', 'POST')

export function shouldPollCodeBuddyAuth(status: CodeBuddyAuthStatus): boolean {
  return status.operation_state === 'waiting'
}
