import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from '../ProfilePage.vue'
import { api, authStatus } from '../../api'
import { useRouter } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn(), authStatus: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: vi.fn() }))
vi.mock('../../avatarImage', () => ({ cropAvatarToSquare: vi.fn() }))
const apiMock = vi.mocked(api)
const replace = vi.fn()
const profile = { id: 'u1', username: 'learner', role: 'user', created_at: '2026-01-01T00:00:00Z', avatar: '' }

describe('ProfilePage', () => {
  beforeEach(() => {
    apiMock.mockReset()
    replace.mockReset()
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
    vi.mocked(authStatus).mockResolvedValue({ enabled: true, authenticated: true })
    apiMock.mockImplementation(async (path, init) => {
      if (path === '/api/auth/profile' && !init) return { ...profile }
      if (path === '/api/auth/profile/learner-profile' && !init) return { learner_profile: { grade_level: 'Grade 8' } }
      if (path === '/api/auth/profile' && init?.method === 'PUT') return { avatar: JSON.parse(String(init.body)).avatar }
      if (path === '/api/auth/profile/learner-profile' && init?.method === 'PUT') return { learner_profile: JSON.parse(String(init.body)) }
      return {}
    })
  })

  it('applies a validated avatar icon without duplicating learner settings', async () => {
    const wrapper = mount(ProfilePage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('learner')
    expect(wrapper.text()).toContain('查看账户信息并个性化你的头像')
    expect(wrapper.find('.profile-back').exists()).toBe(true)
    expect(wrapper.text()).toContain('用户')
    expect(wrapper.text()).toContain('注册时间：2026年1月1日')
    expect(wrapper.find('.profile-fields').exists()).toBe(false)
    await wrapper.get('button[aria-label="star"]').trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/auth/profile', expect.objectContaining({ method: 'PUT', body: expect.stringContaining('icon:star:') }))
  })

  it('removes an uploaded image and signs out', async () => {
    apiMock.mockImplementation(async (path, init) => {
      if (path === '/api/auth/profile' && !init) return { ...profile, avatar: 'img:1' }
      if (path === '/api/auth/profile/learner-profile') return { learner_profile: null }
      return {}
    })
    const wrapper = mount(ProfilePage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '移除照片')?.trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/auth/profile/avatar', { method: 'DELETE' })
    await wrapper.findAll('button').find(button => button.text() === '退出登录')?.trigger('click')
    await flushPromises()
    expect(replace).toHaveBeenCalledWith('/login')
  })

  it('redirects away from accounts when authentication is disabled', async () => {
    vi.mocked(authStatus).mockResolvedValue({ enabled: false, authenticated: false })
    mount(ProfilePage)
    await flushPromises()
    expect(replace).toHaveBeenCalledWith('/')
    expect(apiMock).not.toHaveBeenCalled()
  })
})
