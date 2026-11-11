import { describe, expect, it } from 'vitest'
import {
  noticeIsBlocking,
  noticeSeverityLabel,
  noticeTone,
  sortNotices,
  type ReadinessNotice,
} from '../readinessNotices'

describe('noticeTone', () => {
  it('maps known severities to UI tones', () => {
    expect(noticeTone('blocker')).toBe('danger')
    expect(noticeTone('warning')).toBe('warning')
    expect(noticeTone('suggestion')).toBe('info')
  })
  it('degrades unknown severity to warning', () => {
    expect(noticeTone('mystery')).toBe('warning')
  })
})

describe('noticeSeverityLabel', () => {
  it('returns Chinese labels with warning fallback', () => {
    expect(noticeSeverityLabel('blocker')).toBe('阻断')
    expect(noticeSeverityLabel('warning')).toBe('警告')
    expect(noticeSeverityLabel('suggestion')).toBe('建议')
    expect(noticeSeverityLabel('x')).toBe('警告')
  })
})

describe('noticeIsBlocking', () => {
  it('treats blocker and warning as blocking, suggestion as advisory', () => {
    expect(noticeIsBlocking({ severity: 'blocker' })).toBe(true)
    expect(noticeIsBlocking({ severity: 'warning' })).toBe(true)
    expect(noticeIsBlocking({ severity: 'suggestion' })).toBe(false)
  })
})

describe('sortNotices', () => {
  it('orders blocker → warning → suggestion while keeping within-tier order', () => {
    const notices: ReadinessNotice[] = [
      { code: 's1', row_id: 'r', section: 'runtime', severity: 'suggestion' },
      { code: 'b1', row_id: 'r', section: 'runtime', severity: 'blocker' },
      { code: 'w1', row_id: 'r', section: 'runtime', severity: 'warning' },
      { code: 'b2', row_id: 'r', section: 'runtime', severity: 'blocker' },
    ]
    expect(sortNotices(notices).map(n => n.code)).toEqual(['b1', 'b2', 'w1', 's1'])
  })
  it('does not mutate the input array', () => {
    const input: ReadinessNotice[] = [
      { code: 's', row_id: 'r', section: 'runtime', severity: 'suggestion' },
      { code: 'b', row_id: 'r', section: 'runtime', severity: 'blocker' },
    ]
    sortNotices(input)
    expect(input.map(n => n.code)).toEqual(['s', 'b'])
  })
})
