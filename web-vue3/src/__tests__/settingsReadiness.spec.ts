import { describe, expect, it } from 'vitest'
import {
  groupReadinessRows,
  isProminentReadinessRow,
  readinessRowHref,
  readinessRowSeverity,
  type ReadinessRow,
} from '../settingsReadiness'

const row = (overrides: Partial<ReadinessRow> = {}): ReadinessRow => ({
  id: 'catalog.llm',
  section: 'catalog',
  label: 'LLM',
  state: 'enabled_verified',
  detail_code: '',
  enabled: true,
  available: true,
  configured: true,
  verified: true,
  required: true,
  ...overrides,
})

describe('settings readiness helpers', () => {
  it('keeps declared section order and appends unknown sections', () => {
    expect(
      groupReadinessRows([
        row({ id: 'future.one', section: 'future' }),
        row({ id: 'runtime.redis', section: 'runtime' }),
        row({ id: 'tool.search', section: 'tools' }),
      ]).map(group => group.section),
    ).toEqual(['tools', 'runtime', 'future'])
  })

  it('grades required failures and configured faults without complaining about optional idle rows', () => {
    expect(readinessRowSeverity(row({ state: 'unavailable', required: true }))).toBe('blocker')
    expect(readinessRowSeverity(row({ state: 'misconfigured', required: false }))).toBe('warning')
    expect(readinessRowSeverity(row({ state: 'not_selected', required: false }))).toBeNull()
    expect(isProminentReadinessRow(row({ state: 'available_disabled' }))).toBe(false)
  })

  it('maps every actionable prefix to its settings surface', () => {
    expect(readinessRowHref('catalog.task')).toBe('/settings/task-models')
    expect(readinessRowHref('parser.mineru')).toBe('/settings/knowledge')
    expect(readinessRowHref('tool.videogen')).toBe('/settings/tools')
    expect(readinessRowHref('video.invidious')).toBe('/settings/video-learning')
    expect(readinessRowHref('runtime.coordination.redis')).toBe('/settings/network')
    expect(readinessRowHref('unknown.item')).toBeNull()
  })
})
