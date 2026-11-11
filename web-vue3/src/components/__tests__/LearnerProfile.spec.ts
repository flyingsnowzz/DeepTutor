import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import LearnerProfile from '../LearnerProfile.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn() }))

describe('LearnerProfile', () => {
  it('loads and saves non-empty learner preferences', async () => {
    const apiMock = vi.mocked(api)
    apiMock.mockImplementation(async path => path === '/api/auth/profile/learner-profile' ? { learner_profile: { age: 12, grade_level: '6' } } : {})
    const wrapper = mount(LearnerProfile)
    await flushPromises()
    expect((wrapper.get('input[type="number"]').element as HTMLInputElement).value).toBe('12')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    const put = apiMock.mock.calls.find(call => call[1]?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ age: 12, grade_level: '6' })
  })
})
