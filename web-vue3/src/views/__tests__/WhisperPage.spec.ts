import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WhisperPage from '../WhisperPage.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn() }))
const apiMock = vi.mocked(api)
class FakeSocket {
  static OPEN = 1
  static instances: FakeSocket[] = []
  readyState = 0
  sent: any[] = []
  onopen?: () => void
  onmessage?: (event: { data: string }) => void
  onclose?: () => void
  onerror?: () => void
  constructor(_url: string) { FakeSocket.instances.push(this); setTimeout(() => { this.readyState = 1; this.onopen?.() }, 0) }
  send(raw: string) { this.sent.push(JSON.parse(raw)) }
  emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
  close() { this.readyState = 3; this.onclose?.() }
}

describe('WhisperPage', () => {
  beforeEach(() => { apiMock.mockReset(); FakeSocket.instances = []; vi.stubGlobal('WebSocket', FakeSocket) })
  it('shows the unavailable-plugin state without opening a socket', async () => {
    apiMock.mockResolvedValue({ capabilities: [] })
    const wrapper = mount(WhisperPage)
    await flushPromises()
    expect(wrapper.text()).toContain('服务器尚未安装 Whisper')
    expect(FakeSocket.instances).toHaveLength(0)
  })

  it('keeps supervisor messages on the trainee seat and carries the room into trainee turns', async () => {
    apiMock.mockResolvedValue({ capabilities: [{ id: 'whisper_visitor', available: true }] })
    const wrapper = mount(WhisperPage)
    await flushPromises()
    await wrapper.get('textarea').setValue('I need help')
    await wrapper.get('button.primary').trigger('click')
    await vi.waitFor(() => expect(FakeSocket.instances[0].sent.length).toBe(1))
    const socket = FakeSocket.instances[0]
    expect(socket.sent[0]).toMatchObject({ capability: 'whisper_visitor', config: {} })
    socket.emit({ type: 'session_meta', session_id: 'visitor-session' })
    socket.emit({ type: 'content', content: 'Created room_id=room-123' })
    socket.emit({ type: 'done' })
    await flushPromises()
    await wrapper.get('button[role="tab"]:nth-of-type(2)').trigger('click')
    await wrapper.get('textarea').setValue('Tell me more')
    await wrapper.get('button.primary').trigger('click')
    await vi.waitFor(() => expect(socket.sent.length).toBe(2))
    expect(socket.sent[1]).toMatchObject({ capability: 'whisper_trainee', config: { room_id: 'room-123' } })
    socket.emit({ type: 'session_meta', session_id: 'trainee-session' })
    socket.emit({ type: 'content', content: 'Private supervisor hint', stage: 'whisper', source: 'whisper_trainee' })
    socket.emit({ type: 'done' })
    await flushPromises()
    expect(wrapper.text()).toContain('Private supervisor hint')
    await wrapper.get('button[role="tab"]:nth-of-type(1)').trigger('click')
    expect(wrapper.text()).not.toContain('Private supervisor hint')
    expect(wrapper.text()).toContain('Created room_id=room-123')
  })

  it('locks a room after a trainee crisis summary and can reset it', async () => {
    apiMock.mockResolvedValue({ capabilities: [{ id: 'whisper_visitor', available: true }] })
    const wrapper = mount(WhisperPage)
    await flushPromises()
    await wrapper.get('textarea').setValue('Start')
    await wrapper.get('button.primary').trigger('click')
    await vi.waitFor(() => expect(FakeSocket.instances[0].sent.length).toBe(1))
    const socket = FakeSocket.instances[0]
    socket.emit({ type: 'content', content: 'room_id=room-1' })
    socket.emit({ type: 'done' })
    await flushPromises()
    await wrapper.get('button[role="tab"]:nth-of-type(2)').trigger('click')
    socket.emit({ type: 'content', content: 'This room was closed for crisis referral. No further counseling or whispers.', stage: 'debrief' })
    await flushPromises()
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).disabled).toBe(true)
    await wrapper.findAll('button').find(button => button.text() === '新房间')!.trigger('click')
    expect(wrapper.text()).not.toContain('closed for crisis referral')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).disabled).toBe(false)
  })
})
