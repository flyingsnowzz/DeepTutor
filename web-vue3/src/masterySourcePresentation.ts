type StreamLikeEvent = {
  type?: string
  source?: string
  metadata?: Record<string, unknown>
}

export interface PresentedSourcePage {
  title: string
  preview_url: string
}

export function presentedSourcePages(events: StreamLikeEvent[] | undefined): PresentedSourcePage[] {
  if (!events?.length) return []
  const pages = new Map<string, PresentedSourcePage>()
  for (const event of events) {
    if (event.type !== 'sources' || !['chat', 'mastery_path'].includes(event.source || '')) continue
    const sources = event.metadata?.sources
    if (!Array.isArray(sources)) continue
    for (const source of sources) {
      if (!source || typeof source !== 'object') continue
      const item = source as Record<string, unknown>
      if (!['teaching', 'reveal'].includes(String(item.presentation || ''))) continue
      const title = typeof item.title === 'string' ? item.title : ''
      const previewUrl = typeof item.preview_url === 'string' ? item.preview_url : ''
      if (!title || !/^\/api\/knowledge-bases\/[A-Za-z0-9_%.-]+\/source-page\?/.test(previewUrl)) continue
      if (new URL(previewUrl, 'https://source.invalid').pathname !== previewUrl.split('?')[0]) continue
      pages.set(previewUrl, { title, preview_url: previewUrl })
    }
  }
  return [...pages.values()].slice(0, 12)
}
