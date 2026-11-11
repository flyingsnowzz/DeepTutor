import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KanbanPage from '../KanbanPage.vue'
import { api, post } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn(), post: vi.fn() }))
const apiMock = vi.mocked(api)
const postMock = vi.mocked(post)
const card = { id: 't1', title: 'Read chapter', note: 'Chapter 3', status: 'todo' as const, due_date: '2026-11-09', archived: false }
const board = { cards: [card], revision: 1, colors: { todo: '#2563eb', doing: '#a16207', done: '#15803d' }, session_links: [] }

describe('KanbanPage', () => {
  beforeEach(() => {
    apiMock.mockReset(); postMock.mockReset()
    apiMock.mockImplementation(async (path, init) => {
      if (path === '/api/task-board') return board
      if (path === '/api/calendar/task-blocks') return { t1: 2 }
      if (init?.method === 'PATCH') return { ...board, cards: [{ ...card, ...JSON.parse(String(init.body)) }] }
      if (init?.method === 'PUT') return { ...board, colors: JSON.parse(String(init.body)) }
      return board
    })
    postMock.mockResolvedValue(board)
  })

  it('edits title, note and due date and shows calendar blocks', async () => {
    const wrapper = mount(KanbanPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('已排 2 段')
    await wrapper.get('.task-card-open').trigger('click')
    await wrapper.get('input[aria-label="任务标题"]').setValue('Read chapter 4')
    await wrapper.get('input[aria-label="截止日期"]').setValue('2026-11-10')
    await wrapper.get('.task-card form').trigger('submit.prevent')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/task-board/cards/t1', expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('Read chapter 4') }))
    expect(apiMock).toHaveBeenCalledWith('/api/task-board/cards/t1', expect.objectContaining({ body: expect.stringContaining('"due_date":"2026-11-10"') }))
  })

  it('moves cards with drag and drop and restores archived cards', async () => {
    const wrapper = mount(KanbanPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('.task-card').trigger('dragstart')
    await wrapper.get('section[aria-label="进行中"]').trigger('drop')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/task-board/cards/t1', expect.objectContaining({ body: JSON.stringify({ status: 'doing' }) }))
    await wrapper.findAll('button').find(button => button.text() === '显示已归档')?.trigger('click')
    expect(wrapper.text()).toContain('没有已归档任务')
  })

  it('saves status colors and creates a task', async () => {
    const wrapper = mount(KanbanPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('button[aria-label="状态颜色"]').trigger('click')
    await wrapper.get('input[aria-label="待办颜色值"]').setValue('#112233')
    await wrapper.get('.task-color-save').trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/task-board/colors', expect.objectContaining({ method: 'PUT', body: expect.stringContaining('#112233') }))
    await wrapper.get('input[aria-label="新任务"]').setValue('New task')
    await wrapper.get('.task-create').trigger('submit.prevent')
    await flushPromises()
    expect(postMock).toHaveBeenCalledWith('/api/task-board/cards', { title: 'New task' })
  })
})
