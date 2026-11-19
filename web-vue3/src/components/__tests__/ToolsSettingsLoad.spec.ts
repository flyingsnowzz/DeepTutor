import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ToolsSettings from '../ToolsSettings.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn() }))
const apiMock = vi.mocked(api)
const payload = (name: string) => ({ enabled_optional_tools: [name], tools: [{
  name, description: name, parameters: [], hints: { en: { short_description: name, when_to_use: '', input_format: '', guideline: '', note: '', aliases: [] } },
  aliases: [], toggleable: true, enabled: true, available: true,
}] })

describe('ToolsSettings loading', () => {
  beforeEach(() => apiMock.mockReset())

  it('reloads on revision and ignores an older response', async () => {
    let resolveOld!: (value: ReturnType<typeof payload>) => void
    const old = new Promise<ReturnType<typeof payload>>(resolve => { resolveOld = resolve })
    apiMock.mockImplementationOnce(() => old as ReturnType<typeof api>)
    apiMock.mockResolvedValueOnce(payload('web_search') as never)
    const wrapper = mount(ToolsSettings, { props: { enabledTools: [], revision: 0 } })
    await wrapper.setProps({ revision: 1 })
    await flushPromises()
    expect(wrapper.text()).toContain('web_search')
    expect(wrapper.emitted('loaded')?.at(-1)?.[0]).toEqual(['web_search'])
    resolveOld(payload('brainstorm'))
    await flushPromises()
    expect(wrapper.text()).not.toContain('brainstorm')
    expect(wrapper.emitted('loaded')).toHaveLength(1)
    wrapper.unmount()
  })

  it('does not emit a late result after leaving the page', async () => {
    let resolve!: (value: ReturnType<typeof payload>) => void
    apiMock.mockImplementationOnce(() => new Promise<ReturnType<typeof payload>>(next => { resolve = next }) as ReturnType<typeof api>)
    const wrapper = mount(ToolsSettings, { props: { enabledTools: [] } })
    wrapper.unmount()
    resolve(payload('web_search'))
    await flushPromises()
    expect(wrapper.emitted('loaded')).toBeUndefined()
  })
})
