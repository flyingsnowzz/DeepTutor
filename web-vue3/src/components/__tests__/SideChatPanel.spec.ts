import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SideChatPanel from '../SideChatPanel.vue'

class FakeSocket {
  static instances: FakeSocket[] = []
  readyState = 0
  sent: unknown[] = []
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onclose?: () => void
  onerror?: () => void
  constructor(public url: string) {
    FakeSocket.instances.push(this)
    setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0)
  }
  send(raw: string) { this.sent.push(JSON.parse(raw)) }
  emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
  close() { this.readyState = 3; this.onclose?.() }
}

describe('SideChatPanel', () => {
  beforeEach(() => {
    FakeSocket.instances = []
    vi.stubGlobal('WebSocket', FakeSocket)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('opens an isolated side-chat turn with selection context and quoted text', async () => {
    const wrapper = mount(SideChatPanel, {
      props: {
        context: {
          parentSessionId: 'parent-1',
          leafMessageId: 7,
          responder: { kind: 'dito' },
        },
        seedQuote: { id: 3, text: 'Important passage' },
        language: 'zh',
        llmOptions: [{ profile_id: 'p1', model_id: 'm1', profile_name: 'Primary', model_name: 'Model One' }],
        knowledgeBases: [{ name: 'Algebra' }, { name: 'Codex', metadata: { type: 'subagent' } }],
      },
      global: {
        stubs: {
          MarkdownView: { props: ['content'], template: '<div>{{ content }}</div>' },
          TurnActivityStream: { template: '<div><slot /></div>' },
          SideChatResponderMenu: true,
          QuestionBankPicker: {
            props: ['open'],
            emits: ['apply', 'close'],
            template: '<button v-if="open" data-test="pick-question" @click="$emit(\'apply\', [7]); $emit(\'close\')">pick question</button>',
          },
          NotebookRecordPicker: true,
          BookReferencePicker: true,
          ReadingReferencePicker: true,
          HistorySessionPicker: true,
          MemoryPicker: true,
        },
      },
    })
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
    const fileInput = wrapper.get('input[type="file"]').element as HTMLInputElement
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
    await wrapper.get('input[type="file"]').trigger('change')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('note.txt'))
    await wrapper.get('.side-chat-resources select').setValue('p1:m1')
    await wrapper.get('.side-chat-resource-body fieldset > label input[type="checkbox"]').setValue(true)
    await flushPromises()
    await wrapper.findAll('.side-chat-reference-actions button').find(button => button.text().includes('题库'))?.trigger('click')
    await wrapper.get('[data-test="pick-question"]').trigger('click')
    await wrapper.find('textarea').setValue('Why is this important?')
    await wrapper.find('.side-chat-input-row button:last-child').trigger('click')
    await flushPromises()

    const socket = FakeSocket.instances[0]
    expect(socket.url).toContain('/ws')
    await vi.waitFor(() => expect(socket.sent.length).toBe(1))
    const command = socket.sent[0] as Record<string, any>
    expect(command).toMatchObject({
      type: 'start_turn',
      capability: 'chat',
      language: 'zh',
      llm_selection: { profile_id: 'p1', model_id: 'm1' },
      knowledge_bases: ['Algebra'],
      question_notebook_references: [7],
      config: {
        answer_by: '',
        _persistent_knowledge_bases: ['Algebra'],
        _resource_reuse: expect.objectContaining({
          knowledge: true,
          persona: true,
          skills: true,
          mcp: true,
          question_bank: false,
        }),
        selection_tutor_context: {
          parent_session_id: 'parent-1',
          source_message_id: 7,
        },
      },
    })
    expect(command.attachments.map((attachment: { type: string }) => attachment.type)).toEqual(['quote', 'file'])

    socket.emit({ type: 'session_meta', session_id: 'side-1', turn_id: 'turn-1' })
    socket.emit({ type: 'content', content: 'Because it defines the premise.' })
    socket.emit({ type: 'done' })
    await flushPromises()
    expect(wrapper.emitted('session-id')?.[0]).toEqual(['side-1'])
    expect(wrapper.text()).toContain('Because it defines the premise.')
  })
})
