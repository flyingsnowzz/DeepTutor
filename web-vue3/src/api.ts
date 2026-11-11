import { scopedUrl } from './workspaceScope'

export interface AuthStatus {
  enabled: boolean
  authenticated: boolean
  user_id?: string
  username?: string
  is_admin?: boolean
  is_super_admin?: boolean
}

export const BACKEND_UNAVAILABLE_MESSAGE = '无法连接 DeepTutor 后端服务。请确认后端已启动，并检查 Vite 的 API 代理地址。'
export const SERVICE_CONNECTION_FAILED_MESSAGE = '后端依赖的服务暂时无法连接，请检查模型或网络服务后重试。'

export class ApiError extends Error {
  constructor(public status: number, message: string, public technicalMessage?: string) {
    super(message)
    this.name = 'ApiError'
  }
}

const CONNECTION_ERROR = /ConnectionRefusedError|ECONNREFUSED|Errno 61|fetch failed|socket hang up|connect ECONNREFUSED|NetworkError/i

function reportBackendAvailability(available: boolean) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(available ? 'deeptutor:backend-available' : 'deeptutor:backend-unavailable'))
}

function detailMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail
    if (typeof detail === 'string' && detail.trim()) return detail
  }
  return fallback
}

export function friendlyApiMessage(status: number, detail: string | null | undefined): string {
  const raw = (detail || '').trim()
  if (status === 0 || status === 502 || status === 503 || status === 504) return BACKEND_UNAVAILABLE_MESSAGE
  if (CONNECTION_ERROR.test(raw)) return SERVICE_CONNECTION_FAILED_MESSAGE
  return raw || '请求失败，请稍后重试。'
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(scopedUrl(path), { credentials: 'include', ...init })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    reportBackendAvailability(false)
    const message = friendlyApiMessage(0, cause instanceof Error ? cause.message : '')
    throw new ApiError(0, message, cause instanceof Error ? cause.message : String(cause))
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const raw = detailMessage(body, response.statusText)
    reportBackendAvailability(![502, 503, 504].includes(response.status))
    throw new ApiError(response.status, friendlyApiMessage(response.status, raw), raw)
  }
  reportBackendAvailability(true)
  return body as T
}

export function post<T>(path: string, value: unknown): Promise<T> {
  return api<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  })
}

export function authStatus(): Promise<AuthStatus> {
  return api<AuthStatus>('/api/auth/status')
}
