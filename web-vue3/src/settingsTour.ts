export interface SettingsTourStep {
  target: string
  route: string
  title: string
  description: string
}

export const SETTINGS_TOUR_STEPS: SettingsTourStep[] = [
  {
    target: 'tour-status',
    route: '/settings/status',
    title: '状态',
    description: '在这里查看后端连接、内存占用，以及各项服务是否就绪。',
  },
  {
    target: 'tour-page-heading',
    route: '/settings/appearance',
    title: '外观',
    description: '视觉主题与代码块样式，应用设置后会在整个界面生效。',
  },
  {
    target: 'tour-page-heading',
    route: '/settings/network',
    title: '网络',
    description: '配置端口、浏览器 API 地址与 CORS，适配 Docker、局域网和反向代理。',
  },
  {
    target: 'tour-page-heading',
    route: '/settings/llm',
    title: '模型',
    description: '按用途选择模型。提供方管理可复用凭据，模型分配决定各任务使用哪个模型。',
  },
  {
    target: 'tour-page-heading',
    route: '/settings/knowledge',
    title: '知识库',
    description: '选择文档解析引擎，决定上传文件如何转换为可检索文本。',
  },
  {
    target: 'tour-page-heading',
    route: '/settings/starters',
    title: '对话',
    description: '调整首页起始建议和回复等待时长。工具和学习能力在左侧各有独立页面。',
  },
  {
    target: 'tour-page-heading',
    route: '/settings/memory',
    title: '记忆',
    description: '调整记忆整理流程：分块、LLM 预算、去重和引用策略。',
  },
]

export function nextTourIndex(index: number): number {
  const next = index + 1
  return next >= SETTINGS_TOUR_STEPS.length ? -1 : next
}

export function previousTourIndex(index: number): number {
  return Math.max(0, index - 1)
}

export function tourStepAt(index: number): SettingsTourStep | null {
  return index >= 0 && index < SETTINGS_TOUR_STEPS.length
    ? SETTINGS_TOUR_STEPS[index]!
    : null
}
