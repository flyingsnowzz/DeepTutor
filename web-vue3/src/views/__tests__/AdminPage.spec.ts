import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminPage from '../AdminPage.vue'
import { api, authStatus, post } from '../../api'
import { useRouter } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn(), authStatus: vi.fn(), post: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const replace = vi.fn()

describe('AdminPage', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset(); replace.mockReset()
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
  })

  it('allows a super administrator to create administrators and validates passwords', async () => {
    vi.mocked(authStatus).mockResolvedValue({ enabled: true, authenticated: true, is_admin: true, is_super_admin: true, username: 'root' })
    apiMock.mockResolvedValue({ administrators: [] })
    postMock.mockResolvedValue({})
    const wrapper = mount(AdminPage, { props: { mode: 'accounts' }, global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('input[placeholder="邮箱或用户名"]').setValue('admin2')
    await wrapper.get('input[type="password"]').setValue('short')
    await wrapper.get('form').trigger('submit.prevent')
    expect(postMock).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('至少需要 8')
    await wrapper.get('input[type="password"]').setValue('long-enough')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/auth/admin/accounts', { username: 'admin2', password: 'long-enough' })
  })

  it('redirects ordinary administrators away from administrator accounts', async () => {
    vi.mocked(authStatus).mockResolvedValue({ enabled: true, authenticated: true, is_admin: true, is_super_admin: false })
    mount(AdminPage, { props: { mode: 'accounts' }, global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(replace).toHaveBeenCalledWith('/admin/users')
  })

  it('searches users, excludes self from bulk deletion and expands assignments', async () => {
    vi.mocked(authStatus).mockResolvedValue({ enabled: true, authenticated: true, is_admin: true, is_super_admin: false, username: 'admin' })
    apiMock.mockResolvedValue([{ id: 'u1', username: 'admin', role: 'admin', preset: 'custom' }, { id: 'u2', username: 'learner', role: 'user', preset: 'learner', created_at: '2026-01-01' }])
    postMock.mockResolvedValue({ deleted_count: 0, failed_count: 1, results: [{ username: 'learner', ok: false, error: 'Protected' }] })
    const wrapper = mount(AdminPage, { props: { mode: 'users' }, global: { stubs: { RouterLink: true, AdminGrantEditor: true, AdminBookPermission: true, AdminGuardianRelationships: true, AdminLearnerProfile: true } } })
    await flushPromises()
    expect(wrapper.get('input[aria-label="选择 admin"]').attributes('disabled')).toBeDefined()
    await wrapper.get('input[aria-label="选择当前显示的用户"]').setValue(true)
    expect(wrapper.text()).toContain('已选择 1 个用户')
    vi.stubGlobal('confirm', vi.fn(() => true))
    await wrapper.findAll('button').find(button => button.text() === '删除选中')?.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '删除用户')?.trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/auth/users/batch-delete', { usernames: ['learner'] })
    expect(wrapper.get('[role="alert"]').text()).toContain('Protected')
    await wrapper.findAll('button').find(button => button.attributes('aria-label') === '分配权限')?.trigger('click')
    expect(wrapper.findComponent({ name: 'AdminGrantEditor' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'AdminGuardianRelationships' }).exists()).toBe(true)
  })
})
