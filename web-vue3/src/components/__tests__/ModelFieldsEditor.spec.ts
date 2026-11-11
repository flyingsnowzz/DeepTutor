import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ModelFieldsEditor from '../ModelFieldsEditor.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn() }))
const apiMock = vi.mocked(api)

function makeModel(overrides: Record<string, unknown> = {}): any {
  return { id: 'm1', model: 'gpt-test', name: 'Test model', ...overrides }
}
const profile = { id: 'p1', name: 'Provider', provider: 'openai', binding: 'openai' }

describe('ModelFieldsEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiMock.mockReset()
    apiMock.mockResolvedValue({ defaults: { tools: true, vision: false, json_output: true, reasoning: true } })
  })
  afterEach(() => vi.useRealTimers())

  it('edits the LLM context window and marks it manual, clearing detected values', async () => {
    const model = makeModel({ context_window_tokens: 8192, context_window_detected_at: '2026-01-01' })
    const wrapper = mount(ModelFieldsEditor, { props: { service: 'llm', profile, model } })
    await vi.runAllTimersAsync()
    await wrapper.get('input[aria-label="上下文长度（tokens）"]').setValue('32768')
    expect(model.context_window).toBe('32768')
    expect(model.context_window_source).toBe('manual')
    expect(model.context_window_tokens).toBeUndefined()
    expect(model.context_window_detected_at).toBeUndefined()

    await wrapper.get('button.model-field-link').trigger('click')
    expect(model.context_window).toBeUndefined()
    expect(model.context_window_source).toBe('default')
  })

  it('updates reasoning effort from the dropdown', async () => {
    const model = makeModel()
    const wrapper = mount(ModelFieldsEditor, { props: { service: 'llm', profile, model } })
    await vi.runAllTimersAsync()
    await wrapper.get('select[aria-label="推理强度"]').setValue('high')
    expect(model.reasoning_effort).toBe('high')
  })

  it('supports the three-way capability override and resolves Auto values from the backend', async () => {
    const model = makeModel()
    const wrapper = mount(ModelFieldsEditor, { props: { service: 'llm', profile, model } })
    await vi.runAllTimersAsync()
    expect(apiMock).toHaveBeenCalledWith('/api/settings/model-capabilities', expect.objectContaining({ method: 'POST' }))
    const toolsSelect = wrapper.get('select[aria-label="工具调用（Tool calling）"]')
    expect((toolsSelect.element as HTMLSelectElement).value).toBe('auto')
    await toolsSelect.setValue('false')
    expect(model.capabilities?.tools).toBe(false)
    await toolsSelect.setValue('true')
    expect(model.capabilities?.tools).toBe(true)
    await toolsSelect.setValue('auto')
    // Backend normalizes an empty capabilities map; UI simply drops the key.
    expect(model.capabilities?.tools).toBeUndefined()
  })

  it('exposes embedding dimensions and the send-dimensions switch', async () => {
    const model = makeModel()
    const wrapper = mount(ModelFieldsEditor, { props: { service: 'embedding', profile, model } })
    await vi.runAllTimersAsync()
    await wrapper.get('input[aria-label="维度（Dimensions）"]').setValue('1536')
    expect(model.dimension).toBe('1536')
    const sendDims = wrapper.get('select[aria-label="在嵌入请求中发送维度参数"]')
    expect((sendDims.element as HTMLSelectElement).value).toBe('auto')
    await sendDims.setValue('true')
    expect(model.send_dimensions).toBe(true)
    await sendDims.setValue('auto')
    expect(model.send_dimensions).toBeNull()
  })

  it('shows image/video generation scalar fields per service', async () => {
    const model = makeModel()
    const wrapper = mount(ModelFieldsEditor, { props: { service: 'imagegen', profile, model } })
    await vi.runAllTimersAsync()
    await wrapper.get('input[aria-label="图片尺寸"]').setValue('1024x1024')
    await wrapper.get('input[aria-label="质量"]').setValue('hd')
    expect(model.size).toBe('1024x1024')
    expect(model.quality).toBe('hd')
  })

  it('locks every control when the model is managed by a signed-in provider', async () => {
    const model = makeModel({ managed_by: 'openai-codex' })
    const wrapper = mount(ModelFieldsEditor, { props: { service: 'llm', profile, model } })
    await vi.runAllTimersAsync()
    expect(wrapper.get('input[aria-label="上下文长度（tokens）"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('select[aria-label="推理强度"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('托管')
    // Attempted writes are ignored.
    await wrapper.get('select[aria-label="推理强度"]').setValue('high')
    expect(model.reasoning_effort).toBeUndefined()
  })
  it('edits display name and model id, writing user_name when managed', async () => {
    const model = makeModel()
    const wrapper = mount(ModelFieldsEditor, { props: { service: 'llm', profile, model } })
    await vi.runAllTimersAsync()
    await wrapper.get('input[aria-label="模型显示名称"]').setValue('展示名')
    expect(model.name).toBe('展示名')
    await wrapper.get('input[aria-label="模型 ID"]').setValue('gpt-4o')
    expect(model.model).toBe('gpt-4o')

    const managedModel = makeModel({ managed_by: 'openai-codex', name: 'Codex' })
    const managedWrapper = mount(ModelFieldsEditor, { props: { service: 'llm', profile, model: managedModel } })
    await vi.runAllTimersAsync()
    await managedWrapper.get('input[aria-label="模型显示名称"]').setValue('我的 Codex')
    expect(managedModel.user_name).toBe('我的 Codex')
    expect(managedModel.name).toBe('Codex')
    // The provider model id stays locked for a managed connection.
    expect(managedWrapper.get('input[aria-label="模型 ID"]').attributes('disabled')).toBeDefined()
  })

})
