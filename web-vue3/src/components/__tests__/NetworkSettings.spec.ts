import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NetworkSettings from '../NetworkSettings.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn() }))
const apiMock = vi.mocked(api)
const payload = (port: number) => ({
  settings: { backend_port: port, frontend_port: 3783, public_api_base: '', cors_origins: [] },
  effective: { browser_api_base: 'http://localhost:8001', cors_mode: 'permissive' },
  auth: { enabled: false, cookie_secure: false, cookie_samesite: 'Lax', cross_site_cookie_ready: true },
  restart_required: true,
})

describe('NetworkSettings', () => {
  beforeEach(() => apiMock.mockReset())

  it('ignores an old response after a newer revision loads', async () => {
    let resolveOld!: (value: ReturnType<typeof payload>) => void
    const old = new Promise<ReturnType<typeof payload>>(resolve => { resolveOld = resolve })
    apiMock.mockImplementationOnce(() => old as ReturnType<typeof api>)
    apiMock.mockResolvedValueOnce(payload(9001) as never)
    const wrapper = mount(NetworkSettings, {
      props: { revision: 0 },
      global: { stubs: { RuntimeStatusSettings: true } },
    })
    await wrapper.setProps({ revision: 1 })
    await flushPromises()
    expect((wrapper.get('input[aria-label="后端端口"]').element as HTMLInputElement).value).toBe('9001')
    resolveOld(payload(8001))
    await flushPromises()
    expect((wrapper.get('input[aria-label="后端端口"]').element as HTMLInputElement).value).toBe('9001')
    wrapper.unmount()
  })
})
