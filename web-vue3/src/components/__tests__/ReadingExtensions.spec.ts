import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReadingExtensions from '../ReadingExtensions.vue'
import { api, post } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)

describe('ReadingExtensions', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset()
    apiMock.mockResolvedValue([{ id: 'translation', actions: [{ id: 'translate', label: '翻译' }] }])
    postMock.mockResolvedValue({ translation: 'Translated', alternatives: [] })
  })

  it('runs a selected-text extension and shows its result', async () => {
    const wrapper = mount(ReadingExtensions, { props: { materialId: 'm1', selection: 'Selected', locator: 2 } })
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/reading/materials/m1/extensions/translation/actions/translate', expect.objectContaining({ locator: 2, selection: 'Selected' }))
    expect(wrapper.text()).toContain('Translated')
  })
})
