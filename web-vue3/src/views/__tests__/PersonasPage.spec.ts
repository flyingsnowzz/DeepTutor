import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PersonasPage from '../PersonasPage.vue'
import { api, post } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const persona = { name: 'patient-tutor', description: 'Patient', source: 'user', read_only: false, content: '# Style\n\nBe patient.' }

describe('PersonasPage', () => {
  beforeEach(() => { apiMock.mockReset(); postMock.mockReset(); vi.restoreAllMocks() })

  it('creates a persona with a slugged name and refreshes the list', async () => {
    apiMock.mockResolvedValue({ personas: [] })
    postMock.mockResolvedValue(persona)
    const wrapper = mount(PersonasPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('header button').trigger('click')
    await wrapper.get('input[placeholder="patient-tutor"]').setValue('Patient Tutor!')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/personas', expect.objectContaining({ name: 'patient-tutor' }))
    expect(wrapper.find('.resource-editor').exists()).toBe(false)
    expect(wrapper.text()).toContain('Persona 已保存')
  })

  it('loads a detail, strips frontmatter and saves a rename', async () => {
    apiMock.mockImplementation(async (path, init) => {
      if (path === '/api/personas') return { personas: [persona] }
      if (path === '/api/personas/patient-tutor' && !init) return { ...persona, content: '---\nname: patient-tutor\n---\n# Style' }
      if (path === '/api/personas/patient-tutor' && init?.method === 'PUT') return { ...persona, name: 'kind-tutor' }
      throw new Error(`Unexpected request: ${path} ${init?.method}`)
    })
    const wrapper = mount(PersonasPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '编辑')?.trigger('click')
    await flushPromises()
    const input = wrapper.get('input[placeholder="patient-tutor"]')
    expect((input.element as HTMLInputElement).value).toBe('patient-tutor')
    await input.setValue('kind-tutor')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/personas/patient-tutor', expect.objectContaining({ method: 'PUT', body: expect.stringContaining('"rename_to":"kind-tutor"') }))
  })

  it('keeps administrator personas read-only and confirms deletion for owned personas', async () => {
    apiMock.mockImplementation(async path => {
      if (path === '/api/personas') return { personas: [persona, { ...persona, name: 'admin', source: 'admin', read_only: true }] }
      return {}
    })
    vi.stubGlobal('confirm', vi.fn(() => true))
    const wrapper = mount(PersonasPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    const cards = wrapper.findAll('.partner-card')
    expect(cards[1].text()).toContain('只读')
    expect(cards[1].findAll('button')).toHaveLength(1)
    await cards[0].findAll('button').find(button => button.text() === '删除')?.trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/personas/patient-tutor', { method: 'DELETE' })
  })
})
