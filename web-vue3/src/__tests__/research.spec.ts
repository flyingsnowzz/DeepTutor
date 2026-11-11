import { describe, expect, it } from 'vitest'
import {
  buildResearchWSConfig,
  createEmptyResearchConfig,
  normalizeOutline,
  normalizeResearchConfig,
  RESEARCH_DEPTHS,
  RESEARCH_MODES,
  summarizeResearchConfig,
  validateResearchConfig,
} from '../research'

describe('normalizeResearchConfig', () => {
  it('keeps known mode/depth and drops invalid values', () => {
    expect(normalizeResearchConfig({ mode: 'report', depth: 'deep', extra: 1 })).toEqual({
      mode: 'report',
      depth: 'deep',
    })
    expect(normalizeResearchConfig({ mode: 'essay', depth: 'infinite' })).toEqual(createEmptyResearchConfig())
    expect(normalizeResearchConfig(undefined)).toEqual(createEmptyResearchConfig())
  })
})

describe('validateResearchConfig', () => {
  it('requires both mode and depth', () => {
    expect(validateResearchConfig(createEmptyResearchConfig())).toEqual({
      valid: false,
      errors: { mode: '必选', depth: '必选' },
    })
    expect(validateResearchConfig({ mode: 'report', depth: 'quick' }).valid).toBe(true)
  })
})

describe('buildResearchWSConfig', () => {
  it('throws on incomplete config', () => {
    expect(() => buildResearchWSConfig({ mode: '', depth: '' })).toThrow()
  })
  it('sends mode/depth and only includes manual fields for manual depth', () => {
    const auto = buildResearchWSConfig({ mode: 'report', depth: 'deep', manual_subtopics: 4 })
    expect(auto).toEqual({ mode: 'report', depth: 'deep' })
    const manual = buildResearchWSConfig({
      mode: 'notes',
      depth: 'manual',
      manual_subtopics: 4,
      manual_max_iterations: 2,
    })
    expect(manual).toEqual({ mode: 'notes', depth: 'manual', manual_subtopics: 4, manual_max_iterations: 2 })
  })
  it('includes a confirmed outline when present', () => {
    const outline = [{ title: 'A', overview: 'a' }]
    expect(buildResearchWSConfig({ mode: 'report', depth: 'deep' }, outline).confirmed_outline).toEqual(outline)
    expect(
      buildResearchWSConfig({ mode: 'report', depth: 'deep', confirmed_outline: outline }).confirmed_outline,
    ).toEqual(outline)
    expect(buildResearchWSConfig({ mode: 'report', depth: 'deep' }, []).confirmed_outline).toBeUndefined()
  })
})

describe('summarizeResearchConfig', () => {
  it('summarizes valid configs and flags incomplete ones', () => {
    expect(summarizeResearchConfig({ mode: '', depth: '' })).toBe('设置不完整')
    expect(summarizeResearchConfig({ mode: 'report', depth: 'deep' })).toBe('研究报告 · 深入')
    expect(summarizeResearchConfig({ mode: 'learning_path', depth: 'quick' })).toBe('学习路径 · 快速')
  })
})

describe('normalizeOutline', () => {
  it('trims entries and drops empty titles', () => {
    expect(
      normalizeOutline([
        { title: '  Intro  ', overview: '  overview ' },
        { title: '   ', overview: 'x' },
      ]),
    ).toEqual([{ title: 'Intro', overview: 'overview' }])
    expect(normalizeOutline(undefined)).toEqual([])
  })
})

describe('option tables', () => {
  it('exposes four modes and four depths', () => {
    expect(RESEARCH_MODES.map(m => m.value)).toEqual(['notes', 'report', 'comparison', 'learning_path'])
    expect(RESEARCH_DEPTHS.map(d => d.value)).toEqual(['quick', 'standard', 'deep', 'manual'])
  })
})
