import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PartnerConsultationPanel from '../PartnerConsultationPanel.vue'
import { api, post } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)

describe('PartnerConsultationPanel', () => {
  beforeEach(() => {
    apiMock.mockReset()
    postMock.mockReset()
    apiMock.mockImplementation(async path => {
      if (String(path).includes('/history?')) return []
      if (String(path).endsWith('/sessions')) return [{ session_key: 's1', title: 'Consultation' }]
      return {}
    })
    postMock.mockResolvedValue({ archived: true })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: content\ndata: {"content":"Streamed answer"}\n\n'))
          controller.close()
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('uploads attachments, streams a partner answer and archives the embedded session', async () => {
    const wrapper = mount(PartnerConsultationPanel, {
      props: {
        kind: 'partner',
        id: 'p1',
        sessionKey: 's1',
        name: 'Ada',
      },
      global: {
        stubs: {
          MarkdownView: { props: ['content'], template: '<div>{{ content }}</div>' },
        },
      },
    })
    await flushPromises()
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
    Object.defineProperty(wrapper.get('input[type="file"]').element, 'files', { value: [file] })
    await wrapper.get('input[type="file"]').trigger('change')
    await vi.waitFor(() => expect(wrapper.text()).toContain('note.txt'))
    await wrapper.get('textarea').setValue('Read this note')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({
      content: 'Read this note',
      session_key: 's1',
      attachments: [{ filename: 'note.txt', base64: 'aGVsbG8=', mime_type: 'text/plain' }],
    })
    expect(wrapper.text()).toContain('Streamed answer')

    await wrapper.get('button[aria-label="归档当前对话"]').trigger('click')
    expect(postMock).toHaveBeenCalledWith('/api/partners/p1/sessions/archive', { session_key: 's1' })
  })

  it('keeps slash commands local instead of sending them to the model', async () => {
    const wrapper = mount(PartnerConsultationPanel, {
      props: { kind: 'partner', id: 'p1', sessionKey: 's1', name: 'Ada' },
      global: {
        stubs: {
          MarkdownView: { props: ['content'], template: '<div>{{ content }}</div>' },
        },
      },
    })
    await flushPromises()
    await wrapper.get('textarea').setValue('/sessions')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(fetch).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Consultation')
    expect(wrapper.text()).toContain('/resume <会话 ID>')
  })
})
