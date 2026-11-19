import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GuardianSettings from '../GuardianSettings.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
const apiMock = vi.mocked(api)

describe('GuardianSettings', () => {
  beforeEach(() => {
    apiMock.mockReset()
    apiMock.mockImplementation(async path => {
      if (path === '/api/multi-user/me/guardianships') return { relationships: [{ id: 'r1', learner_user_id: 'u1', learner_username: 'Learner', permissions: ['view_reports', 'assign_materials', 'manage_restrictions'] }] }
      if (String(path).endsWith('/guardian-report')) return { learner: { username: 'Learner' }, assigned_materials: [], grant_summary: { model_count: 1, knowledge_base_count: 0, skill_count: 0 } }
      if (String(path).endsWith('/materials')) return { materials: [{ book_id: 'b1', title: 'Book', assigned: false }] }
      if (String(path).endsWith('/restrictions')) return { restrictions: { age_band: '9-12', allow_upload: false, allowed_surfaces: [], extensions: [] }, available_extensions: [{ id: 'translation', name: 'Translation' }] }
      return {}
    })
  })
  it('loads a learner and stages assigned materials', async () => {
    const wrapper = mount(GuardianSettings)
    await flushPromises()
    await wrapper.get('.guardian-learner-grid button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Learner')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(wrapper.emitted('change')?.[0]).toEqual(['guardian:materials:u1', ['b1']])
  })
})
