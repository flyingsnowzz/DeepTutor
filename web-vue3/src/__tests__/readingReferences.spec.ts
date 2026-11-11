import { describe, expect, it } from 'vitest'
import {
  MAX_READING_REFERENCE_MATERIALS,
  MAX_READING_REFERENCE_UNITS,
  countSelectedReadingUnits,
  normalizeReadingReferences,
  selectedReadingsToPayload,
  type SelectedReadingReference,
} from '../readingReferences'

describe('reading references', () => {
  it('serializes selected units and deduplicates locators', () => {
    const selected: SelectedReadingReference[] = [{
      materialId: 'abcdef12',
      revision: 3,
      materialTitle: 'Paper',
      unit: 'section',
      units: [{ locator: 2, title: 'Two' }, { locator: 4, title: 'Four' }],
    }]
    expect(countSelectedReadingUnits(selected)).toBe(2)
    expect(selectedReadingsToPayload(selected)).toEqual([
      { material_id: 'abcdef12', revision: 3, locators: [2, 4] },
    ])
    expect(normalizeReadingReferences([
      { material_id: 'abcdef12', revision: 3, locators: [2, 2, 4] },
    ])).toEqual([{ material_id: 'abcdef12', revision: 3, locators: [2, 4] }])
  })

  it('enforces the legacy material and unit caps', () => {
    const references = Array.from({ length: MAX_READING_REFERENCE_MATERIALS + 2 }, (_, index) => ({
      material_id: `${String(index + 1).padStart(8, '0')}`,
      revision: 1,
      locators: [index + 1],
    }))
    expect(normalizeReadingReferences(references)).toHaveLength(MAX_READING_REFERENCE_MATERIALS)

    const one = [{ material_id: 'abcdef12', revision: 1, locators: Array.from({ length: 40 }, (_, index) => index + 1) }]
    expect(normalizeReadingReferences(one)[0].locators).toHaveLength(MAX_READING_REFERENCE_UNITS)
  })
})
