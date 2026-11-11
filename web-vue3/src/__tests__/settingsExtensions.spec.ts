import { describe, expect, it } from 'vitest'
import {
  clampToRange,
  effectiveAttachmentLimits,
  largerAttachmentUploadsNeedRestart,
  type AttachmentSettings,
  type AttachmentSettingsPayload,
} from '../settingsExtensions'

const settings: AttachmentSettings = {
  max_file_mb: 20,
  max_total_mb: 25,
  max_chars_per_doc: 200_000,
  max_chars_total: 500_000,
}

const payload: AttachmentSettingsPayload = {
  settings,
  effective: {
    max_file_bytes: 20 * 1024 * 1024,
    max_total_bytes: 25 * 1024 * 1024,
    max_chars_per_doc: 200_000,
    max_chars_total: 500_000,
    ws_max_size: 26_214_400,
  },
  bounds: {
    max_file_mb: [1, 1024],
    max_total_mb: [1, 2048],
    chars: [10_000, 5_000_000],
  },
  restart_required_for_larger_uploads: true,
}

describe('settings extension helpers', () => {
  it('requires a restart only when upload size caps increase', () => {
    expect(
      largerAttachmentUploadsNeedRestart(settings, { ...settings, max_file_mb: 21 }, payload),
    ).toBe(true)
    expect(
      largerAttachmentUploadsNeedRestart(settings, { ...settings, max_total_mb: 20 }, payload),
    ).toBe(false)
    expect(
      largerAttachmentUploadsNeedRestart(settings, settings, {
        ...payload,
        restart_required_for_larger_uploads: false,
      }),
    ).toBe(false)
  })

  it('clamps numeric drafts to backend ranges and exposes effective limits', () => {
    expect(clampToRange(5, [3, 100])).toBe(5)
    expect(clampToRange(200, [3, 100])).toBe(100)
    expect(effectiveAttachmentLimits(payload)?.ws_max_size).toBe(26_214_400)
    expect(effectiveAttachmentLimits(null)).toBeNull()
  })
})
