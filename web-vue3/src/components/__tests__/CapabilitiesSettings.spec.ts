import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CapabilitiesSettings from '../CapabilitiesSettings.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn() }))
const apiMock = vi.mocked(api)
const live = {
  chat: { temperature: 0.7, max_rounds: 12, stage_budgets: { exploring: 4000, responding: 4000 } },
  solve: { temperature: 0.7, max_tokens: 4000, max_rounds: 12, max_replans: 2 },
  research: { temperature: 0.7, max_tokens: 4000, researching: { note_agent_mode: 'auto', tool_timeout: 60, tool_max_retries: 2, paper_search_years_limit: 5 } },
  question: { temperature: 0.7, max_tokens: 4000, exploring: { max_iterations: 6, tool_summarizer: { enabled: true, max_tokens: 1200 } } },
  co_writer: { temperature: 0.7, max_tokens: 4000 }, vision_solver: { temperature: 0.7, max_tokens: 4000 },
  math_animator: { temperature: 0.7, max_tokens: 4000 }, visualize: { temperature: 0.7, max_tokens: 4000 },
}

describe('CapabilitiesSettings', () => {
  beforeEach(() => { apiMock.mockReset() })

  it('blocks editing and offers retry when the backend returns an incomplete payload', async () => {
    apiMock.mockResolvedValueOnce({ chat: { temperature: 0.7 } }).mockResolvedValueOnce(live)
    const wrapper = mount(CapabilitiesSettings, { props: { language: 'en' } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('unexpected capability settings payload')
    expect(wrapper.find('input[type="number"]').exists()).toBe(false)
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Per-capability LLM parameters')
  })

  it('renders English labels and emits loaded values on edit', async () => {
    apiMock.mockResolvedValue(live)
    const wrapper = mount(CapabilitiesSettings, { props: { language: 'en' } })
    await flushPromises()
    await wrapper.get('input[aria-label="Exploring (max tokens)"]').setValue('5000')
    expect((wrapper.emitted('change')?.at(-1)?.[0] as typeof live).chat.stage_budgets.exploring).toBe(5000)
  })

  it('ignores stale settings from a previous revision', async () => {
    let resolveOld!: (value: unknown) => void
    apiMock.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }) as never)
      .mockResolvedValueOnce({ ...live, chat: { ...live.chat, max_rounds: 19 } })
    const wrapper = mount(CapabilitiesSettings, { props: { revision: 0, language: 'en' } })
    await wrapper.setProps({ revision: 1 })
    await flushPromises()
    resolveOld(live)
    await flushPromises()
    expect(wrapper.get('input[aria-label="Max rounds"]').element.getAttribute('value')).toBe('19')
  })
})
