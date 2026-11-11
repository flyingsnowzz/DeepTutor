import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, BACKEND_UNAVAILABLE_MESSAGE, SERVICE_CONNECTION_FAILED_MESSAGE } from '../api'

describe('api connection errors', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('turns a failed dev proxy request into one actionable message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(api('/api/settings')).rejects.toMatchObject({
      status: 0,
      message: BACKEND_UNAVAILABLE_MESSAGE,
    })
  })

  it('hides raw backend dependency connection errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: 'ConnectionRefusedError: [Errno 61] Connection refused',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } })))
    const error = await api('/api/settings').catch(cause => cause) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toBe(SERVICE_CONNECTION_FAILED_MESSAGE)
    expect(error.technicalMessage).toContain('ConnectionRefusedError')
  })

  it('preserves ordinary API validation details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: '标题不能为空' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })))
    await expect(api('/api/sessions', { method: 'POST' })).rejects.toMatchObject({ status: 400, message: '标题不能为空' })
  })
})
