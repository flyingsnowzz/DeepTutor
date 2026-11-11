/**
 * Settings preset presentation — Chinese labels for the value-free preset
 * catalog served by GET /api/settings/presets. Mirrors web/locales/zh/app.json
 * settings.presets.* keys. Pure functions keep the mapping unit-testable.
 */

export interface SettingsPreset {
  id: string
  label: string
  description: string
  parser: string
  resource_cost: string
  credentials: string[]
  prerequisites: string[]
  unlocked_features: string[]
}

const PRESET_NAMES: Record<string, string> = {
  basic_text: '基础文本',
  local_multimodal: '本地多模态',
  university_study: '大学学习',
  full_generation: '完整生成',
}

const PRESET_DESCRIPTIONS: Record<string, string> = {
  basic_text: '面向聊天、笔记和专注推理的轻量文本配置。',
  local_multimodal: '本地解析文档，并准备图像与视频生成工具。',
  university_study: '结合文档解析、网页搜索和论文检索，支持研究型学习。',
  full_generation: '在所有服务配置完成后启用完整生成工具。',
}

const COST_LABELS: Record<string, string> = {
  low: '低成本',
  medium: '中等成本',
  high: '高成本',
}

const CREDENTIAL_LABELS: Record<string, string> = {
  llm: '语言模型',
  imagegen: '图像模型',
  videogen: '视频模型',
}

const PREREQUISITE_LABELS: Record<string, string> = {
  llm_profile: '模型配置',
  markdown_parser: 'Markdown 解析器',
  media_profiles: '媒体服务配置',
  search_profile: '搜索服务配置',
}

const FEATURE_LABELS: Record<string, string> = {
  core_chat: '核心聊天',
  reasoning: '深度推理',
  document_parsing: '文档解析',
  web_search: '网页搜索',
  paper_search: '论文检索',
  image_generation: '图像生成',
  video_generation: '视频生成',
}

export function presetName(id: string): string {
  return PRESET_NAMES[id] ?? id
}

export function presetDescription(id: string): string {
  return PRESET_DESCRIPTIONS[id] ?? ''
}

export function costLabel(cost: string): string {
  return COST_LABELS[cost] ?? cost
}

export function credentialLabel(key: string): string {
  return CREDENTIAL_LABELS[key] ?? key
}

export function prerequisiteLabel(key: string): string {
  return PREREQUISITE_LABELS[key] ?? key
}

export function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? key
}

/** Resolve a backend preset (whose label/description are i18n keys) to display text. */
export function displayPreset(preset: SettingsPreset): SettingsPreset & {
  name: string
  descriptionText: string
  costText: string
  credentialText: string
  prerequisiteText: string
  featureText: string
} {
  return {
    ...preset,
    name: presetName(preset.id),
    descriptionText: presetDescription(preset.id) || preset.description,
    costText: costLabel(preset.resource_cost),
    credentialText: preset.credentials.map(credentialLabel).join(' · '),
    prerequisiteText: preset.prerequisites.map(prerequisiteLabel).join(' · '),
    featureText: preset.unlocked_features.map(featureLabel).join(' · '),
  }
}
