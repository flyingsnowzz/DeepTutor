import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EmbeddingModelUsage from '../EmbeddingModelUsage.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn() }))
const apiMock = vi.mocked(api)

describe('EmbeddingModelUsage', () => {
  beforeEach(() => { apiMock.mockReset() })

  it('shows only knowledge bases using the selected model and its deletion warning', async () => {
    apiMock.mockResolvedValue({ knowledge_bases: [
      { name: 'Math', workspace_name: 'Class A', profile_id: 'p1', model_id: 'm1' },
      { name: 'Science', profile_id: 'p1', model_id: 'm2' },
    ] })
    const wrapper = mount(EmbeddingModelUsage, { props: { profileId: 'p1', modelId: 'm1', language: 'en' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Knowledge bases using this model (1)')
    expect(wrapper.text()).toContain('Math · Class A')
    expect(wrapper.text()).not.toContain('Science')
    expect(wrapper.text()).toContain('documents and indexes will be preserved')
  })

  it('discards an old response after model selection changes', async () => {
    const pending: Array<(value: unknown) => void> = []
    apiMock.mockImplementation(() => new Promise(resolve => pending.push(resolve)) as any)
    const wrapper = mount(EmbeddingModelUsage, { props: { profileId: 'p1', modelId: 'm1' } })
    await nextTick()
    await wrapper.setProps({ modelId: 'm2' })
    await nextTick()
    pending[0]({ knowledge_bases: [{ name: 'Old', profile_id: 'p1', model_id: 'm1' }] })
    await flushPromises()
    expect(wrapper.text()).not.toContain('Old')
    pending[1]({ knowledge_bases: [{ name: 'New', profile_id: 'p1', model_id: 'm2' }] })
    await flushPromises()
    expect(wrapper.text()).toContain('New')
  })

  it('offers retry after a load failure', async () => {
    apiMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ knowledge_bases: [] })
    const wrapper = mount(EmbeddingModelUsage, { props: { profileId: 'p1', modelId: 'm1' } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('失败')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('没有知识库使用此模型')
  })
})
