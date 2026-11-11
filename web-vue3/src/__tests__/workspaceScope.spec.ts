import { describe, expect, it } from 'vitest'
import { scopedUrl, scopedWebSocketUrl } from '../workspaceScope'

describe('workspaceScope', () => {
  it('keeps HTTP requests relative while scoping the workspace', () => {
    expect(scopedUrl('/api/sessions', 'workspace-1')).toBe('/api/sessions?dt_workspace=workspace-1')
  })

  it('turns scoped WebSocket paths into absolute ws URLs', () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    expect(scopedWebSocketUrl('/ws', 'workspace-1')).toBe(
      `${protocol}//${window.location.host}/ws?dt_workspace=workspace-1`,
    )
  })
})
