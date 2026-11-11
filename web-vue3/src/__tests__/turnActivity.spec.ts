import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { activityDetail, humanizeEventType, labelTurnEvent } from '../turnActivity'
import TurnActivityStream from '../components/TurnActivityStream.vue'

describe('labelTurnEvent', () => {
  it('maps known event types to Chinese labels with semantic tones', () => {
    expect(labelTurnEvent('tool_call')).toMatchObject({ label: '调用工具', tone: 'active' })
    expect(labelTurnEvent('error')).toMatchObject({ label: '发生错误', tone: 'danger' })
    expect(labelTurnEvent('done')).toMatchObject({ label: '回合完成', tone: 'success' })
    expect(labelTurnEvent('wait_for_input')).toMatchObject({ tone: 'warning' })
  })
  it('infers tone from prefixes for unknown but conventional types', () => {
    expect(labelTurnEvent('something_failed').tone).toBe('danger')
    expect(labelTurnEvent('render_complete').tone).toBe('success')
    expect(labelTurnEvent('phase_started').tone).toBe('active')
  })
  it('falls back to a neutral readable label for fully unknown types', () => {
    const label = labelTurnEvent('totally_new_event')
    expect(label.tone).toBe('neutral')
    expect(label.label).toBe('totally new event')
  })
  it('defensively labels stage-only events without a type', () => {
    expect(labelTurnEvent(undefined)).toMatchObject({ label: 'event', tone: 'neutral' })
  })
})

describe('humanizeEventType', () => {
  it('splits snake_case into spaced text', () => {
    expect(humanizeEventType('active_turn_info')).toBe('active turn info')
  })
})

describe('activityDetail', () => {
  it('prefers content then message and truncates long text', () => {
    expect(activityDetail({ content: 'hi', message: 'ignored' })).toBe('hi')
    expect(activityDetail({ message: 'msg' })).toBe('msg')
    const long = 'x'.repeat(200)
    expect(activityDetail({ content: long })).toHaveLength(141)
    expect(activityDetail({})).toBe('')
  })
})

describe('TurnActivityStream', () => {
  it('renders nothing without events', () => {
    const wrapper = mount(TurnActivityStream, { props: { events: [] } })
    expect(wrapper.find('details').exists()).toBe(false)
  })
  it('renders a labeled, tone-classed row per event with count', () => {
    const wrapper = mount(TurnActivityStream, {
      props: { events: [
        { type: 'tool_call', content: '搜索网络' },
        { type: 'error', message: '失败' },
      ] },
    })
    expect(wrapper.text()).toContain('当前活动（2）')
    const rows = wrapper.findAll('.turn-activity-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].classes()).toContain('tone-active')
    expect(rows[0].text()).toContain('调用工具')
    expect(rows[0].text()).toContain('搜索网络')
    expect(rows[1].classes()).toContain('tone-danger')
  })
})
