import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EduHubImport from '../EduHubImport.vue'
import { api, post } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const skill = { slug: 'research-helper', name: 'Research Helper', summary: 'Find sources', version: '1.0.0', downloads: 12, stars: 3, owner: 'eduhub' }

describe('EduHubImport', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset()
    apiMock.mockImplementation(async path => {
      if (String(path).startsWith('/api/skills/hub/catalog')) return { skills: [skill, { ...skill, slug: 'writer', name: 'Writer', summary: 'Write well' }], web_url: 'https://eduhub.example' }
      if (String(path).startsWith('/api/skills/hub/detail')) return { ...skill, content: '# Research\n\nCite sources.', tags: ['research'] }
      throw new Error(`Unexpected request: ${path}`)
    })
    postMock.mockResolvedValue({ verdict: { status: 'verified' } })
  })

  it('searches the catalog, previews markdown and installs the selected skill', async () => {
    const wrapper = mount(EduHubImport)
    await flushPromises()
    expect(wrapper.text()).toContain('Research Helper')
    await wrapper.get('input[type="search"]').setValue('research')
    expect(wrapper.text()).not.toContain('Write well')
    await wrapper.get('[role="button"][aria-label="查看详情：Research Helper"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.hub-detail h1').text()).toBe('Research')
    await wrapper.get('.hub-detail header button').trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/skills/install', { ref: 'eduhub:research-helper', force: false, allow_unverified: false })
    expect(wrapper.emitted('installed')).toHaveLength(1)
    expect(wrapper.text()).toContain('已导入')
  })

  it('forces re-download only for an installed skill and closes detail before modal', async () => {
    const wrapper = mount(EduHubImport, { props: { installedNames: new Set(['research-helper']) } })
    await flushPromises()
    await wrapper.get('[role="button"][aria-label="查看详情：Research Helper"]').trigger('click')
    await flushPromises()
    await wrapper.get('.hub-detail header button').trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/skills/install', expect.objectContaining({ force: true }))
    await wrapper.trigger('keydown', { key: 'Escape' })
    // Window owns the keyboard listener; invoke it explicitly for jsdom.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.find('.hub-detail').exists()).toBe(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
