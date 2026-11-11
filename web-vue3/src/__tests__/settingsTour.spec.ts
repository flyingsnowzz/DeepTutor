import { describe, expect, it } from 'vitest'
import {
  nextTourIndex,
  previousTourIndex,
  SETTINGS_TOUR_STEPS,
  tourStepAt,
} from '../settingsTour'

describe('settings tour', () => {
  it('moves through every settings step and closes after the last one', () => {
    expect(SETTINGS_TOUR_STEPS).toHaveLength(7)
    expect(tourStepAt(0)?.route).toBe('/settings/status')
    expect(nextTourIndex(0)).toBe(1)
    expect(previousTourIndex(0)).toBe(0)
    expect(nextTourIndex(SETTINGS_TOUR_STEPS.length - 1)).toBe(-1)
    expect(tourStepAt(-1)).toBeNull()
  })
})
