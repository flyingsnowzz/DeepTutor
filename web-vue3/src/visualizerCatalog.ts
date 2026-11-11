import { api } from './api'
import type { VisualizerCatalogItem } from './visualizeConfig'

const BASE = '/api/visualizers'

export async function listVisualizers(): Promise<VisualizerCatalogItem[]> {
  const result = await api<{ visualizers?: VisualizerCatalogItem[] }>(`${BASE}/list`)
  return result.visualizers ?? []
}

export async function installBundledVisualizer(id: string): Promise<void> {
  await api(`${BASE}/bundled/${encodeURIComponent(id)}/install`, { method: 'POST' })
}

export async function setVisualizerEnabled(id: string, enabled: boolean): Promise<void> {
  await api(`${BASE}/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' })
}

export async function uninstallVisualizer(id: string): Promise<void> {
  await api(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function importVisualizer(file: File): Promise<void> {
  const body = new FormData()
  body.set('file', file)
  await api(`${BASE}/import`, { method: 'POST', body })
}
