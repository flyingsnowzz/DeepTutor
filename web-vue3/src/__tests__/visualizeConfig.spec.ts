import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VISUALIZE_CONFIG,
  buildVisualizeWSConfig,
  isManimRenderMode,
  summarizeVisualizeConfig,
} from '../visualizeConfig'

describe('visualize config', () => {
  it('builds the public WS config and trims the style hint', () => {
    expect(
      buildVisualizeWSConfig({ render_mode: 'svg', quality: 'high', style_hint: '  warm  ' }),
    ).toEqual({ render_mode: 'svg', quality: 'high', style_hint: 'warm' })
  })

  it('summarizes native and Manim modes', () => {
    expect(summarizeVisualizeConfig(DEFAULT_VISUALIZE_CONFIG)).toBe('自动')
    expect(summarizeVisualizeConfig({ render_mode: 'manim_video', quality: 'high', style_hint: '' })).toBe(
      '数学动画 · 高',
    )
    expect(isManimRenderMode('manim_image')).toBe(true)
    expect(isManimRenderMode('svg')).toBe(false)
  })
})
