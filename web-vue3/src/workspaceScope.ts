const storageKey = 'deeptutor:workspace'

export function activeWorkspaceId(): string {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  const explicit = params.get('dt_workspace') ?? params.get('workspace')
  if (explicit !== null) {
    try { sessionStorage.setItem(storageKey, explicit); localStorage.setItem(storageKey, explicit) } catch { /* Storage can be disabled. */ }
    return explicit
  }
  try { return sessionStorage.getItem(storageKey) ?? localStorage.getItem(storageKey) ?? '' }
  catch { return '' }
}

export function scopedUrl(path: string, workspaceId = activeWorkspaceId()): string {
  if (typeof window === 'undefined' || path.startsWith('//')) return path
  if (!path.startsWith('/') && !/^https?:\/\//.test(path)) return path
  const url = new URL(path, window.location.origin)
  if (url.origin !== window.location.origin) return path
  if (!url.searchParams.has('dt_workspace')) url.searchParams.set('dt_workspace', url.searchParams.get('workspace') ?? workspaceId)
  return /^https?:\/\//.test(path) ? url.toString() : `${url.pathname}${url.search}${url.hash}`
}

export function scopedWebSocketUrl(path: string, workspaceId = activeWorkspaceId()): string {
  if (typeof window === 'undefined') return path
  const scoped = scopedUrl(path, workspaceId)
  if (/^wss?:\/\//.test(scoped)) return scoped
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${scoped}`
}
