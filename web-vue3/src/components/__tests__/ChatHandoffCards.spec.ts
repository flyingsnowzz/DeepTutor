import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PartnerDraftCard from '../PartnerDraftCard.vue'
import MasteryHandoffCard from '../MasteryHandoffCard.vue'
import MasterySourcePresentation from '../MasterySourcePresentation.vue'
import { api } from '../../api'
import { useRouter } from 'vue-router'
import { consumeMasteryOpeningPrompt } from '../../pendingPrompt'

vi.mock('../../api', () => ({ api: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const push = vi.fn()

const draft = {
  draft_id: 'a'.repeat(32),
  owner_id: 'u1',
  name: 'Coach',
  description: 'Learning coach',
  soul: 'Be supportive.',
  language: 'zh',
  emoji: '🎓',
  color: '#123456',
  status: 'pending' as const,
  version: 1,
}

const handoff = {
  kind: 'open' as const,
  path_id: 'p1',
  path_name: 'Algebra',
  emoji: '📘',
  session_id: 's1',
  session_title: 'Equations',
  session_messages: 3,
  session_updated_at: 1,
  session_awaiting: false,
  session_running: false,
  module_id: 'm1',
  module_name: 'Lesson 1',
  opening_message: 'Review equations',
  reason: 'Pick up where you left off',
  due_reviews: 2,
  mastered: 3,
  objectives: 8,
}

describe('chat handoff cards', () => {
  beforeEach(() => {
    apiMock.mockReset()
    push.mockReset()
    sessionStorage.clear()
    vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>)
  })

  it('edits and confirms a partner draft before navigating', async () => {
    apiMock.mockResolvedValue({ partner_id: 'partner-1' })
    const wrapper = mount(PartnerDraftCard, {
      props: { data: draft },
      global: { stubs: { LegacyIcon: true } },
    })
    await wrapper.findAll('button').find(button => button.text().includes('编辑'))?.trigger('click')
    await wrapper.get('input[aria-label="伙伴名称"]').setValue('Study Coach')
    await wrapper.findAll('button').find(button => button.text().includes('确认并创建'))?.trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith(
      `/api/partners/drafts/${draft.draft_id}/confirm`,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"name":"Study Coach"'),
      }),
    )
    await wrapper.findAll('button').find(button => button.text().includes('打开伙伴'))?.trigger('click')
    expect(push).toHaveBeenCalledWith('/partners/partner-1')
  })

  it('routes an editable mastery handoff and stores its opening line', async () => {
    const wrapper = mount(MasteryHandoffCard, {
      props: { data: handoff },
      global: { stubs: { LegacyIcon: true } },
    })
    await wrapper.get('textarea').setValue('Explain graphing again')
    await wrapper.findAll('button').find(button => button.text().includes('继续学习'))?.trigger('click')
    expect(push).toHaveBeenCalledWith('/learning/mastery/p1/sessions/s1')
    expect(consumeMasteryOpeningPrompt()).toBe('Explain graphing again')
  })

  it('renders authenticated mastery source pages and revokes object URLs', async () => {
    const preview = '/api/knowledge-bases/course/source-page?document=lecture.pdf&page=7'
    const blob = new Blob(['image'], { type: 'image/png' })
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: vi.fn().mockResolvedValue(new Response(blob, { status: 200 })),
    })
    URL.createObjectURL = vi.fn(() => 'blob:source-page')
    URL.revokeObjectURL = vi.fn()
    const wrapper = mount(MasterySourcePresentation, {
      props: {
        events: [{
          type: 'sources',
          source: 'mastery_path',
          metadata: { sources: [{ title: 'Lesson page', preview_url: preview, presentation: 'teaching' }] },
        }],
      },
    })
    await vi.waitFor(() => expect(wrapper.find('img').exists()).toBe(true))
    expect(wrapper.get('img').attributes('src')).toBe('blob:source-page')
    wrapper.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:source-page')
  })
})
