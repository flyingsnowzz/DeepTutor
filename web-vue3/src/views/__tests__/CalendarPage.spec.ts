import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CalendarPage from '../CalendarPage.vue'
import { api, post } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const today = new Date()
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
const event = { id: 'e1', event_id: 'e1', occurrence: today.toISOString(), recurring: false, calendar_id: 'c1', title: 'Study', notes: '', location: '', all_day: true, start: dayKey(today), end: dayKey(today), rrule: null, color: null }
const task = { id: 't1', title: 'Task', status: 'todo' as const, due_date: dayKey(today), archived: false }

describe('CalendarPage', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset()
    vi.stubGlobal('EventSource', class { onmessage = null; close = vi.fn() })
    apiMock.mockImplementation(async (path, init) => {
      if (path === '/api/calendar/calendars') return { calendars: [{ id: 'c1', name: 'Main', color: '#123456', visible: true, is_default: true }] }
      if (String(path).startsWith('/api/calendar/events?')) return { occurrences: [event] }
      if (String(path).startsWith('/api/calendar/layers?')) return { reviews: [{ date: dayKey(today), mastery: 1, practice: 2 }], automations: [{ id: 'a1', job_id: 'j1', name: 'Reminder', at: 'tomorrow', enabled: true }], footprints: [{ date: dayKey(today), session_count: 2, practice_reviews: 3, mastery_evidence: 1 }] }
      if (path === '/api/task-board') return { cards: [task] }
      if (String(path).startsWith('/api/calendar/automations/')) return {}
      if (String(path).startsWith('/api/calendar/undo/')) return {}
      if (String(path).startsWith('/api/calendar/events/e1') && init?.method === 'DELETE') return { undo_token: 'undo1' }
      return {}
    })
    vi.stubGlobal('confirm', vi.fn(() => true))
  })

  it('moves events and task due dates with drag and drop', async () => {
    const wrapper = mount(CalendarPage)
    await flushPromises()
    expect(wrapper.text()).toContain('路径 1 · 练习 2')
    await wrapper.get('.calendar-task-chip').trigger('dragstart')
    await wrapper.get(`[data-day="${dayKey(tomorrow)}"]`).trigger('drop')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/task-board/cards/t1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ due_date: dayKey(tomorrow) }) }))
  })

  it('cancels automations and restores a deleted event with its undo token', async () => {
    const wrapper = mount(CalendarPage)
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '取消')?.trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/calendar/automations/j1', { method: 'DELETE' })
    await wrapper.get('.calendar-day-list').findAll('button')[1].trigger('click')
    const detailDelete = document.body.querySelector<HTMLButtonElement>('button[aria-label="删除日程"]')
    expect(detailDelete).not.toBeNull()
    detailDelete!.click()
    await flushPromises()
    const confirmDelete = document.body.querySelector<HTMLButtonElement>('.calendar-delete-confirm .primary')
    expect(confirmDelete).not.toBeNull()
    confirmDelete!.click()
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '撤销删除')?.trigger('click')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/calendar/undo/undo1', {})
  })
})
