import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import ChatPage from '../ChatPage.vue'
import { api } from '../../api'
import { useRoute, useRouter } from 'vue-router'

vi.mock('../../api', () => ({ api: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: vi.fn(), useRouter: vi.fn() }))
const apiMock = vi.mocked(api)
const route = reactive<any>({ path: '/chat', params: {}, query: {} })
const replace = vi.fn()
const push = vi.fn()
class FakeSocket {
  static OPEN = 1
  static instances: FakeSocket[] = []
  readyState = 0
  sent: any[] = []
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onerror?: () => void
  onclose?: () => void
  constructor(public url: string) { FakeSocket.instances.push(this); setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
  send(raw: string) { this.sent.push(JSON.parse(raw)) }
  emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
  close() { this.readyState = 3; this.onclose?.() }
}

describe('ChatPage', () => {
  beforeEach(() => {
    apiMock.mockReset(); replace.mockReset(); FakeSocket.instances = []; sessionStorage.clear(); route.params = {}; route.query = {}; route.path = '/chat'
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace, push } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async path => {
      if (path === '/api/capabilities/registered') return [{ id: 'chat', available: true }, { id: 'deep_research', available: true }]
      if (String(path).startsWith('/api/sessions?')) return { sessions: [] }
      if (path === '/api/sessions/s1') return { id: 's1', title: 'Session', messages: [{ id: 1, role: 'assistant', content: '**Answer**', attachments: [{ type: 'file', filename: 'result.pdf', url: '/files/result.pdf' }] }] }
      return {}
    })
  })

  it('sends capability and attachments, renders markdown and resumes from the last sequence', async () => {
    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('select[aria-label="对话能力"]').setValue('deep_research')
    const researchSelects = wrapper.findAll('select').filter(select => !select.attributes('aria-label'))
    await researchSelects[0].setValue('report')
    await researchSelects[1].setValue('quick')
    await wrapper.findAll('button').find(button => button.text() === '确认')?.trigger('click')
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
    Object.defineProperty(wrapper.get('input[type="file"]').element, 'files', { value: [file] })
    await wrapper.get('input[type="file"]').trigger('change')
    await flushPromises()
    await wrapper.get('textarea').setValue('Analyze this')
    await wrapper.get('form.composer').trigger('submit.prevent')
    await flushPromises()
    const socket = FakeSocket.instances[0]
    await vi.waitFor(() => expect(socket.sent.some(message => message.type === 'start_turn')).toBe(true))
    const start = socket.sent.find(message => message.type === 'start_turn')
    expect(start.capability).toBe('deep_research')
    expect(start.config).toMatchObject({ mode: 'report', depth: 'quick' })
    expect(start.config._resource_reuse).toMatchObject({
      attachments: false,
      chat_history: false,
      knowledge: true,
      persona: true,
      skills: true,
      mcp: true,
    })
    expect(start.config._persistent_knowledge_bases).toEqual([])
    expect(start.persist_user_message).toBe(true)
    expect(start.attachments[0].filename).toBe('note.txt')
    expect(start.attachments[0].base64).toBe('aGVsbG8=')
    socket.emit({ type: 'session_meta', session_id: 's1', turn_id: 't1', seq: 1 })
    route.params = { sessionId: 's1' }
    socket.emit({ type: 'content', session_id: 's1', turn_id: 't1', seq: 2, content: '**Partial**' })
    socket.emit({ type: 'tool_call', session_id: 's1', turn_id: 't1', seq: 3, content: 'search' })
    await flushPromises()
    expect(wrapper.text()).toContain('当前活动')
    socket.close()
    await vi.waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(1))
    await flushPromises()
    await vi.waitFor(() => expect(FakeSocket.instances[1].sent.some(message => message.type === 'resume_from')).toBe(true))
    const resumed = FakeSocket.instances[1].sent.find(message => message.type === 'resume_from')
    expect(resumed).toMatchObject({ turn_id: 't1', seq: 3 })
    FakeSocket.instances[1].emit({ type: 'done', session_id: 's1', turn_id: 't1', seq: 4 })
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.find('.message.assistant strong').exists()).toBe(true))
    expect(wrapper.find('.message.assistant strong').text()).toBe('Answer')
    expect(wrapper.get('.message-attachments a').attributes('href')).toContain('/files/result.pdf')
    await wrapper.get('button[aria-label="重新生成"]').trigger('click')
    await flushPromises()
    const regenerate = FakeSocket.instances[1].sent.find(message => message.type === 'regenerate')
    expect(regenerate).toMatchObject({ session_id: 's1' })
  })

  it('keeps pending attachments for every turn only when attachment reuse is enabled', async () => {
    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
    Object.defineProperty(wrapper.get('input[type="file"]').element, 'files', { value: [file] })
    await wrapper.get('input[type="file"]').trigger('change')
    await flushPromises()
    await wrapper.get('.pending-attachments .resource-reuse-toggle input').setValue(true)
    await wrapper.get('textarea').setValue('Keep this note')
    await wrapper.get('form.composer').trigger('submit.prevent')
    await flushPromises()
    const socket = FakeSocket.instances[0]
    await vi.waitFor(() => expect(socket.sent.some(message => message.type === 'start_turn')).toBe(true))
    const start = socket.sent.find(message => message.type === 'start_turn')
    expect(start.config._resource_reuse.attachments).toBe(true)
    expect(start.attachments[0].filename).toBe('note.txt')
    expect(wrapper.find('.pending-attachment').exists()).toBe(true)
  })
})

describe('ChatPage mastery draft aliases', () => {
  beforeEach(() => {
    apiMock.mockReset(); FakeSocket.instances = []
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.mocked(useRoute).mockReturnValue({ path: '/learning/mastery/p1/sessions/outline', params: { pathId: 'p1', sessionId: 'outline' }, query: {} } as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async path => {
      if (path === '/api/capabilities/registered') return []
      if (String(path).startsWith('/api/mastery-paths/topics/p1/sessions')) return { sessions: [] }
      if (path === '/api/mastery-paths/topics/p1') return { path_id: 'p1', name: 'Math', map: { counts: { mastered: 0, total: 0 }, modules: [] } }
      if (String(path).startsWith('/api/mastery-paths/topics/p1/ask-hint')) return { hint: '' }
      throw new Error(`Unexpected request: ${path}`)
    })
  })

  it('treats outline as a new mastery draft rather than fetching a literal session', async () => {
    const wrapper = mount(ChatPage, { props: { mastery: true }, global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(apiMock.mock.calls.some(call => String(call[0]).includes('/api/sessions/outline'))).toBe(false)
    await wrapper.get('textarea').setValue('Design the route')
    await wrapper.get('form.composer').trigger('submit.prevent')
    await flushPromises()
    await vi.waitFor(() => expect(FakeSocket.instances[0].sent.some(message => message.type === 'start_turn')).toBe(true))
    const start = FakeSocket.instances[0].sent.find(message => message.type === 'start_turn')
    expect(start.mastery_session_mode).toBe('outline')
    expect(start.mastery_path_id).toBe('p1')
  })
})

describe('ChatPage setup signals', () => {
  beforeEach(() => {
    apiMock.mockReset(); push.mockReset(); FakeSocket.instances = []; sessionStorage.clear(); localStorage.clear()
    document.documentElement.className = ''
    route.params = { sessionId: 's1' }; route.query = {}; route.path = '/chat/s1'
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace, push } as unknown as ReturnType<typeof useRouter>)
  })

  it('renders a credential hand-off card from setup tool results', async () => {
    apiMock.mockImplementation(async path => {
      if (path === '/api/capabilities/registered') return []
      if (String(path).startsWith('/api/sessions?')) return { sessions: [] }
      if (path === '/api/sessions/s1') {
        return {
          id: 's1',
          title: 'Session',
          messages: [{
            id: 1,
            role: 'assistant',
            content: 'Need a key.',
            events: [{
              type: 'tool_result',
              tool_call_id: 'credential-1',
              metadata: {
                tool_metadata: {
                  setup_credential: {
                    service: 'llm',
                    label: 'OpenAI',
                    settings_path: '/settings/connections',
                    reason: '缺少 API Key',
                  },
                },
              },
            }],
          }],
        }
      }
      return {}
    })
    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.find('.setup-credential-card').exists()).toBe(true)
    expect(wrapper.text()).toContain('缺少 API Key')
    await wrapper.find('.setup-credential-card button').trigger('click')
    expect(push).toHaveBeenCalledWith('/settings/connections')
  })

  it('refreshes and applies the UI theme after setup_applied', async () => {
    apiMock.mockImplementation(async path => {
      if (path === '/api/capabilities/registered') return []
      if (String(path).startsWith('/api/sessions?')) return { sessions: [] }
      if (path === '/api/sessions/s1') {
        return {
          id: 's1',
          title: 'Session',
          messages: [{
            id: 2,
            role: 'assistant',
            content: 'Done',
            events: [{
              type: 'tool_result',
              tool_call_id: 'applied-1',
              metadata: { tool_metadata: { setup_applied: { key: 'interface.theme' } } },
            }],
          }],
        }
      }
      if (path === '/api/settings/ui') return { theme: 'dark' }
      return {}
    })
    mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await vi.waitFor(() => expect(apiMock).toHaveBeenCalledWith('/api/settings/ui'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('deeptutor-theme')).toBe('dark')
  })

  it('renders partner drafts, mastery handoffs and presented sources from tool events', async () => {
    apiMock.mockImplementation(async path => {
      if (path === '/api/capabilities/registered') return []
      if (String(path).startsWith('/api/sessions?')) return { sessions: [] }
      if (path === '/api/sessions/s1') {
        return {
          id: 's1',
          title: 'Session',
          messages: [{
            id: 3,
            role: 'assistant',
            content: 'Offer',
            events: [
              {
                type: 'tool_result',
                metadata: {
                  tool_metadata: {
                    partner_draft: {
                      draft_id: 'a'.repeat(32),
                      name: 'Coach',
                      description: 'Learning coach',
                      soul: 'Be supportive.',
                      language: 'zh',
                      emoji: '🎓',
                      color: '#123456',
                      status: 'pending',
                      version: 1,
                    },
                    mastery_handoff: {
                      kind: 'new',
                      path_id: 'p1',
                      path_name: 'Algebra',
                      opening_message: 'Begin algebra',
                    },
                  },
                },
              },
              {
                type: 'sources',
                source: 'chat',
                metadata: {
                  sources: [{
                    title: 'Lesson page',
                    preview_url: '/api/knowledge-bases/kb/source-page?document=a.pdf&page=1',
                    presentation: 'teaching',
                  }],
                },
              },
            ],
          }],
        }
      }
      return {}
    })
    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.find('.partner-draft-card').exists()).toBe(true)
    expect(wrapper.find('.mastery-handoff-card').exists()).toBe(true)
    expect(wrapper.find('.mastery-source-presentation').exists()).toBe(true)
  })
})

describe('ChatPage selection actions', () => {
  afterEach(() => vi.restoreAllMocks())
  beforeEach(() => {
    apiMock.mockReset(); push.mockReset(); FakeSocket.instances = []; sessionStorage.clear(); route.params = { sessionId: 's1' }; route.query = {}; route.path = '/chat/s1'
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace, push } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async path => {
      if (path === '/api/capabilities/registered') return []
      if (String(path).startsWith('/api/sessions?')) return { sessions: [] }
      if (path === '/api/sessions/s1') return {
        id: 's1',
        title: 'Conversation',
        messages: [{ id: 9, role: 'assistant', content: 'Selectable passage' }],
      }
      return {}
    })
  })

  it('quotes a transcript selection into the main composer', async () => {
    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    const paragraph = wrapper.get('.message.assistant .markdown-body p').element
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Selectable passage',
      rangeCount: 1,
      getRangeAt: () => ({
        commonAncestorContainer: paragraph.firstChild || paragraph,
        getBoundingClientRect: () => ({ left: 20, right: 120, top: 40, bottom: 60 }),
      }),
    } as unknown as Selection)
    await wrapper.get('.message-list').trigger('mouseup')
    await new Promise(resolve => setTimeout(resolve, 5))
    await flushPromises()
    expect(wrapper.find('.selection-actions').exists()).toBe(true)
    await wrapper.findAll('.selection-actions button')[0]!.trigger('click')
    expect(wrapper.get('.pending-quotes').text()).toContain('Selectable passage')
  })

  it('opens a side chat with the selected passage', async () => {
    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    const paragraph = wrapper.get('.message.assistant .markdown-body p').element
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Side chat passage',
      rangeCount: 1,
      getRangeAt: () => ({
        commonAncestorContainer: paragraph.firstChild || paragraph,
        getBoundingClientRect: () => ({ left: 20, right: 120, top: 40, bottom: 60 }),
      }),
    } as unknown as Selection)
    await wrapper.get('.message-list').trigger('mouseup')
    await new Promise(resolve => setTimeout(resolve, 5))
    await wrapper.findAll('.selection-actions button')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('.side-chat-panel').exists()).toBe(true)
    expect(wrapper.text()).toContain('Side chat passage')
  })
})

describe('ChatPage recovery and editing', () => {
  beforeEach(() => {
    apiMock.mockReset(); replace.mockReset(); FakeSocket.instances = []; sessionStorage.clear(); route.params = {}; route.query = {}; route.path = '/chat'
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace, push } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async path => {
      if (path === '/api/capabilities/registered') return []
      if (String(path).startsWith('/api/sessions?')) return { sessions: [] }
      if (path === '/api/sessions/s1') return { id: 's1', title: 'Session', messages: [{ id: 7, role: 'user', content: 'Original' }] }
      return {}
    })
  })

  it('keeps an unconfirmed submission id for a manual retry', async () => {
    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('textarea').setValue('Unconfirmed')
    await wrapper.get('form.composer').trigger('submit.prevent')
    await vi.waitFor(() => expect(FakeSocket.instances[0].sent.some(message => message.type === 'start_turn')).toBe(true))
    const submissionId = FakeSocket.instances[0].sent[0].client_submission_id
    FakeSocket.instances[0].close()
    await flushPromises()
    expect(wrapper.text()).toContain('尚未确认发送')
    await wrapper.findAll('button').find(button => button.text() === '使用同一提交 ID 重试')?.trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(1))
    await vi.waitFor(() => expect(FakeSocket.instances[1].sent.some(message => message.type === 'start_turn')).toBe(true))
    const retry = FakeSocket.instances[1].sent.find(message => message.type === 'start_turn')
    expect(retry.client_submission_id).toBe(submissionId)
  })

  it('uses the original parent and source id when an edit reconnects', async () => {
    route.params.sessionId = 's1'
    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('button[aria-label="编辑"]').trigger('click')
    const inline = wrapper.get('.chat-inline-edit textarea')
    await inline.setValue('Edited inline')
    expect((wrapper.get('form.composer textarea').element as HTMLTextAreaElement).value).toBe('')
    await inline.trigger('keydown', { key: 'Enter' })
    await vi.waitFor(() => expect(FakeSocket.instances[0].sent.some(message => message.type === 'start_turn')).toBe(true))
    const start = FakeSocket.instances[0].sent.find(message => message.type === 'start_turn')
    expect(start.regenerate).toBe(true)
    expect(start.parent_message_id).toBeNull()
    expect(start.regenerated_from_message_id).toBe(7)
    route.params = {}
  })
})

describe('ChatPage deep research rendering', () => {
  const outlineResult = {
    type: 'result',
    metadata: {
      outline_preview: true,
      topic: 'Transformer',
      sub_topics: [{ title: 'Attention', overview: 'Core mechanism' }],
      research_config: { mode: 'report', depth: 'deep' },
    },
  }

  beforeEach(() => {
    apiMock.mockReset(); replace.mockReset(); FakeSocket.instances = []; sessionStorage.clear(); route.params = {}; route.query = {}; route.path = '/chat'
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
  })

  it('merges an outline turn and its report follow-up into one assistant bubble', async () => {
    route.params = { sessionId: 'r1' }
    apiMock.mockImplementation(async path => {
      if (path === '/api/capabilities/registered') return [{ id: 'chat', available: true }, { id: 'deep_research', available: true }]
      if (String(path).startsWith('/api/sessions?')) return { sessions: [] }
      if (path === '/api/sessions/r1') {
        return {
          id: 'r1',
          title: 'Research',
          preferences: { capability: 'deep_research' },
          messages: [
            { id: 1, role: 'user', content: 'Transformer', parentMessageId: null },
            { id: 2, role: 'assistant', capability: 'deep_research', content: 'Outline ready', parentMessageId: 1, events: [outlineResult] },
            {
              id: 3,
              role: 'assistant',
              capability: 'deep_research',
              content: 'Fallback report',
              parentMessageId: 2,
              events: [
                { stage: 'researching' },
                { type: 'result', metadata: { response: '# Report\n## 1. Intro\n## 2. Body\n## 3. Conclusion\nDone。' } },
                { type: 'done', turn_id: 't2', metadata: { status: 'completed' } },
              ],
            },
          ],
        }
      }
      return {}
    })

    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.findAll('.message.assistant')).toHaveLength(1)
    expect(wrapper.find('.research-outline').exists()).toBe(true)
    await wrapper.get('.research-outline-head').trigger('click')
    expect(wrapper.text()).toContain('Attention')
    expect(wrapper.text()).toContain('Intro')
    expect(wrapper.text()).not.toContain('Fallback report')
  })

  it('confirms an outline by starting a hidden deep-research turn with the preserved config', async () => {
    route.params = { sessionId: 'r2' }
    apiMock.mockImplementation(async path => {
      if (path === '/api/capabilities/registered') return [{ id: 'chat', available: true }, { id: 'deep_research', available: true }]
      if (String(path).startsWith('/api/sessions?')) return { sessions: [] }
      if (path === '/api/sessions/r2') {
        return {
          id: 'r2',
          title: 'Research',
          preferences: { capability: 'deep_research' },
          messages: [
            { id: 1, role: 'assistant', capability: 'deep_research', content: 'Outline ready', events: [outlineResult] },
          ],
        }
      }
      return {}
    })

    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('.research-outline-start').trigger('click')
    await vi.waitFor(() => expect(FakeSocket.instances[0]?.sent.some(message => message.type === 'start_turn')).toBe(true))
    const start = FakeSocket.instances[0].sent.find(message => message.type === 'start_turn')
    expect(start).toMatchObject({
      capability: 'deep_research',
      content: 'Transformer',
      persist_user_message: false,
      config: {
        mode: 'report',
        depth: 'deep',
        confirmed_outline: [{ title: 'Attention', overview: 'Core mechanism' }],
      },
    })
    expect(wrapper.findAll('.message.user')).toHaveLength(0)
  })
})

describe('ChatPage video lesson rendering', () => {
  const videoUrl = '/files/outputs/workspace/chat/video_lesson/turn-1/artifacts/lesson.html'

  beforeEach(() => {
    apiMock.mockReset(); FakeSocket.instances = []; sessionStorage.clear(); route.params = {}; route.query = {}; route.path = '/chat'
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
  })

  it('renders a playable Remotion result even when the resumed message is labelled chat', async () => {
    route.params = { sessionId: 'v1' }
    apiMock.mockImplementation(async path => {
      if (path === '/api/capabilities/registered') return []
      if (String(path).startsWith('/api/sessions?')) return { sessions: [] }
      if (path === '/api/sessions/v1') {
        return {
          id: 'v1',
          title: 'Video',
          messages: [{
            id: 1,
            role: 'assistant',
            capability: 'chat',
            content: 'Here is the lesson.',
            events: [
              { type: 'result', source: 'video_lesson', metadata: { response: 'Here is the lesson.' } },
              {
                type: 'result',
                source: 'video_lesson',
                metadata: {
                  title: 'Calculus',
                  artifacts: [{ type: 'html', url: videoUrl, filename: 'lesson.html' }],
                  code: { language: 'tsx', content: 'export const Lesson = () => null' },
                  render: { duration_seconds: 90, attempts: [{ stage: 'render_check', errors: [] }] },
                },
              },
            ],
          }],
        }
      }
      return {}
    })

    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    const iframe = wrapper.get('iframe')
    expect(iframe.attributes('title')).toBe('Calculus')
    expect(iframe.attributes('src')).toContain(videoUrl)
    expect(iframe.attributes('sandbox')).toBe('allow-scripts')
    expect(wrapper.text()).toContain('查看 Remotion 代码')
    expect(wrapper.text()).toContain('Here is the lesson.')
  })
})

describe('ChatPage quiz persistence', () => {
  beforeEach(() => {
    apiMock.mockReset(); FakeSocket.instances = []; sessionStorage.clear(); route.params = {}; route.query = {}; route.path = '/chat'
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
  })

  it('records completed quiz answers against the persisted turn', async () => {
    route.params = { sessionId: 'q1' }
    apiMock.mockImplementation(async (path, init) => {
      if (path === '/api/capabilities/registered') return []
      if (String(path).startsWith('/api/sessions?')) return { sessions: [] }
      if (path === '/api/sessions/q1') {
        return {
          id: 'q1',
          title: 'Quiz',
          messages: [{
            id: 1,
            role: 'assistant',
            capability: 'deep_question',
            content: 'Quiz ready',
            events: [{
              type: 'result',
              turn_id: 'turn-quiz',
              metadata: {
                summary: {
                  results: [{
                    qa_pair: {
                      question_id: 'q1',
                      question: 'What is 2 + 2?',
                      question_type: 'choice',
                      options: { A: '3', B: '4' },
                      correct_answer: 'B',
                      explanation: 'Two plus two is four.',
                    },
                  }],
                },
              },
            }],
          }],
        }
      }
      if (path === '/api/sessions/q1/quiz-results') return { recorded: true }
      return {}
    })

    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.findAll('.quiz-option')[1].trigger('click')
    await wrapper.get('.quiz-submit').trigger('click')
    await flushPromises()
    const call = apiMock.mock.calls.find(([path]) => path === '/api/sessions/q1/quiz-results')
    expect(call).toBeDefined()
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      turn_id: 'turn-quiz',
      answers: [{ question_id: 'q1', user_answer: 'B', is_correct: true }],
    })
  })
})

describe('ChatPage math animator rendering', () => {
  beforeEach(() => {
    apiMock.mockReset(); FakeSocket.instances = []; sessionStorage.clear(); route.params = {}; route.query = {}; route.path = '/chat'
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
  })

  it('renders math animator media and suppresses the generic result body', async () => {
    route.params = { sessionId: 'm1' }
    apiMock.mockImplementation(async path => {
      if (path === '/api/capabilities/registered') return []
      if (String(path).startsWith('/api/sessions?')) return { sessions: [] }
      if (path === '/api/sessions/m1') {
        return {
          id: 'm1',
          title: 'Animation',
          messages: [{
            id: 1,
            role: 'assistant',
            capability: 'math_animator',
            content: 'Raw result should not duplicate',
            events: [{
              type: 'result',
              metadata: {
                response: 'Raw result should not duplicate',
                output_mode: 'video',
                artifacts: [{ type: 'video', url: '/files/scene.mp4', filename: 'scene.mp4' }],
                code: { language: 'python', content: 'class Scene(Scene): pass' },
                timings: { render: 2.5 },
                render: { quality: 'high' },
              },
            }],
          }],
        }
      }
      return {}
    })

    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.get('video').attributes('src')).toContain('/files/scene.mp4')
    expect(wrapper.text()).toContain('查看 Manim 代码')
    expect(wrapper.text()).not.toContain('Raw result should not duplicate')
  })
})

describe('ChatPage visualization rendering', () => {
  beforeEach(() => {
    apiMock.mockReset(); FakeSocket.instances = []; sessionStorage.clear(); route.params = {}; route.query = {}; route.path = '/chat'
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
  })

  it('renders a visualize canvas result instead of repeating its generic body', async () => {
    route.params = { sessionId: 'viz1' }
    apiMock.mockImplementation(async path => {
      if (path === '/api/capabilities/registered') return []
      if (String(path).startsWith('/api/sessions?')) return { sessions: [] }
      if (path === '/api/sessions/viz1') {
        return {
          id: 'viz1',
          title: 'Visualization',
          messages: [{
            id: 1,
            role: 'assistant',
            capability: 'visualize',
            content: 'Generic body',
            events: [{
              type: 'result',
              metadata: {
                render_type: 'svg',
                payload: { format: 'image/svg+xml', data: '<svg id="chart"><rect id="bar" width="10" height="10"/></svg>' },
                code: { language: 'svg', content: '<svg id="chart"><rect id="bar" width="10" height="10"/></svg>' },
                presentation: { title: 'Sales chart' },
                renderer: { id: 'svg', target: 'native', native_renderer: 'svg' },
              },
            }],
          }],
        }
      }
      return {}
    })

    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.find('.visualization-viewer').exists()).toBe(true)
    expect(wrapper.find('.visualization-svg-root').html()).toContain('id="dtsvg')
    expect(wrapper.text()).not.toContain('Generic body')
    await wrapper.findAll('.visualization-toolbar button')[0].trigger('click')
    expect(wrapper.find('.visualization-code').text()).toContain('<svg')
  })

  it('gates visualize sends behind its confirmed render-mode config', async () => {
    apiMock.mockImplementation(async path => {
      if (path === '/api/capabilities/registered') return [{ id: 'chat', available: true }, { id: 'visualize', available: true }]
      if (String(path).startsWith('/api/sessions?')) return { sessions: [] }
      return {}
    })
    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('select[aria-label="对话能力"]').setValue('visualize')
    await flushPromises()
    expect(wrapper.find('.visualize-config-panel').exists()).toBe(true)
    await wrapper.findAll('button').find(button => button.text() === '确认')?.trigger('click')
    await wrapper.get('textarea').setValue('Draw a sine wave')
    await wrapper.get('form.composer').trigger('submit.prevent')
    await vi.waitFor(() => expect(FakeSocket.instances[0]?.sent.some(message => message.type === 'start_turn')).toBe(true))
    const start = FakeSocket.instances[0].sent.find(message => message.type === 'start_turn')
    expect(start.capability).toBe('visualize')
    expect(start.config).toMatchObject({ render_mode: 'auto', quality: 'medium', style_hint: '' })
  })

  it('rejects an unconfirmed visualize send and opens the activity panel', async () => {
    apiMock.mockImplementation(async path => {
      if (path === '/api/capabilities/registered') return [{ id: 'chat', available: true }, { id: 'visualize', available: true }]
      if (String(path).startsWith('/api/sessions?')) return { sessions: [] }
      return {}
    })
    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('select[aria-label="对话能力"]').setValue('visualize')
    await flushPromises()
    await wrapper.get('textarea').setValue('Draw a sine wave')
    await wrapper.get('form.composer').trigger('submit.prevent')
    await flushPromises()
    expect(FakeSocket.instances).toHaveLength(0)
    expect(wrapper.text()).toContain('请先在活动面板确认可视化设置。')
  })
})

describe('ChatPage ask_user interaction', () => {
  beforeEach(() => {
    apiMock.mockReset(); FakeSocket.instances = []; sessionStorage.clear(); route.params = {}; route.query = {}; route.path = '/chat'
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.mocked(useRoute).mockReturnValue(route as unknown as ReturnType<typeof useRoute>)
    vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>)
    apiMock.mockImplementation(async path => {
      if (path === '/api/capabilities/registered') return [{ id: 'chat', available: true }]
      if (String(path).startsWith('/api/sessions?')) return { sessions: [] }
      return {}
    })
  })

  it('renders a live ask_user card and submits structured answers', async () => {
    const wrapper = mount(ChatPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('textarea').setValue('Help me choose')
    await wrapper.get('form.composer').trigger('submit.prevent')
    await vi.waitFor(() => expect(FakeSocket.instances[0]?.sent.some(message => message.type === 'start_turn')).toBe(true))
    const socket = FakeSocket.instances[0]
    socket.emit({ type: 'session_meta', session_id: 'ask1', turn_id: 'turn1', seq: 1 })
    socket.emit({
      type: 'tool_result',
      session_id: 'ask1',
      turn_id: 'turn1',
      seq: 2,
      tool_call_id: 'call1',
      metadata: {
        tool_metadata: {
          ask_user: {
            questions: [{
              id: 'pace',
              prompt: 'How fast?',
              options: [{ label: 'Fast' }, { label: 'Slow' }],
            }],
          },
        },
      },
    })
    socket.emit({ type: 'wait_for_input', session_id: 'ask1', turn_id: 'turn1', seq: 3 })
    await flushPromises()
    expect(wrapper.find('.ask-user-card').exists()).toBe(true)
    await wrapper.findAll('.ask-user-options button')[0]!.trigger('click')
    await wrapper.get('.ask-user-submit').trigger('click')
    const reply = socket.sent.find(message => message.type === 'submit_user_reply')
    expect(reply).toMatchObject({
      turn_id: 'turn1',
      text: 'Fast',
      answers: [{ questionId: 'pace', text: 'Fast' }],
    })
  })
})
