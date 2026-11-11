import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import JournalPage from '../JournalPage.vue'
import { api } from '../../api'

vi.mock('../../api', () => ({ api: vi.fn() }))
const apiMock = vi.mocked(api)
const journal = {
  mission: { topic: 'Linear algebra', why: 'For graphics', level: 'beginner', updated_at: '2026-11-09T08:00:00Z' },
  last_session: { summary: 'Covered vectors', next_focus: 'Matrices', updated_at: '2026-11-09T08:10:00Z' },
  records: [{ id: 'r1', title: 'Vector basics', insight: 'Vectors have direction.', created_at: '2026-11-09T08:20:00Z' }],
}
const emptyJournal = {
  mission: { topic: '', why: '', level: '', updated_at: '' },
  last_session: { summary: '', next_focus: '', updated_at: '' },
  records: [],
}

describe('JournalPage', () => {
  beforeEach(() => { apiMock.mockReset() })

  it('renders mission, handoff and confirmed records', async () => {
    apiMock.mockResolvedValue(journal)
    const wrapper = mount(JournalPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('Linear algebra')
    expect(wrapper.text()).toContain('For graphics')
    expect(wrapper.text()).toContain('Matrices')
    expect(wrapper.text()).toContain('Vectors have direction.')
    expect(wrapper.find('time[datetime="2026-11-09T08:00:00Z"]').exists()).toBe(true)
  })

  it('renders useful empty states', async () => {
    apiMock.mockResolvedValue(emptyJournal)
    const wrapper = mount(JournalPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('导师尚未记录你的学习目标')
    expect(wrapper.text()).toContain('暂无会话交接。')
    expect(wrapper.text()).toContain('暂无已确认的学习记录')
  })

  it('supports refresh and explains read failures without destroying the source data', async () => {
    apiMock.mockResolvedValueOnce(journal).mockRejectedValueOnce(new Error('Journal unavailable'))
    const wrapper = mount(JournalPage, { global: { stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Journal unavailable')
    expect(wrapper.find('button').attributes('disabled')).toBeUndefined()
    expect(apiMock).toHaveBeenCalledTimes(2)
  })
})
