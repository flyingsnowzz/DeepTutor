import { describe, expect, it } from 'vitest'
import {
  costLabel,
  credentialLabel,
  displayPreset,
  featureLabel,
  presetDescription,
  presetName,
  prerequisiteLabel,
  type SettingsPreset,
} from '../settingsPresets'

describe('preset label maps', () => {
  it('resolves known preset names and descriptions', () => {
    expect(presetName('basic_text')).toBe('基础文本')
    expect(presetName('full_generation')).toBe('完整生成')
    expect(presetDescription('university_study')).toContain('研究型学习')
  })

  it('falls back to the raw key for unknown ids', () => {
    expect(presetName('unknown_preset')).toBe('unknown_preset')
    expect(presetDescription('unknown_preset')).toBe('')
  })

  it('maps cost, credentials, prerequisites and features', () => {
    expect(costLabel('low')).toBe('低成本')
    expect(costLabel('high')).toBe('高成本')
    expect(credentialLabel('imagegen')).toBe('图像模型')
    expect(prerequisiteLabel('search_profile')).toBe('搜索服务配置')
    expect(featureLabel('paper_search')).toBe('论文检索')
    expect(featureLabel('mystery')).toBe('mystery')
  })
})

describe('displayPreset', () => {
  const raw: SettingsPreset = {
    id: 'local_multimodal',
    label: 'settings.presets.local_multimodal.name',
    description: 'settings.presets.local_multimodal.description',
    parser: 'markitdown',
    resource_cost: 'medium',
    credentials: ['llm', 'imagegen', 'videogen'],
    prerequisites: ['llm_profile', 'markdown_parser', 'media_profiles'],
    unlocked_features: ['document_parsing', 'image_generation', 'video_generation'],
  }

  it('produces joined Chinese display text', () => {
    const view = displayPreset(raw)
    expect(view.name).toBe('本地多模态')
    expect(view.costText).toBe('中等成本')
    expect(view.parser).toBe('markitdown')
    expect(view.credentialText).toBe('语言模型 · 图像模型 · 视频模型')
    expect(view.prerequisiteText).toContain('Markdown 解析器')
    expect(view.featureText).toBe('文档解析 · 图像生成 · 视频生成')
    expect(view.descriptionText).toContain('视频生成工具')
  })

  it('does not mutate the input preset', () => {
    const snapshot = JSON.stringify(raw)
    displayPreset(raw)
    expect(JSON.stringify(raw)).toBe(snapshot)
  })
})
