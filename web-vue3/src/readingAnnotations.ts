import { api } from './api'

export type AnnotationKind = 'highlight' | 'underline' | 'note' | 'citation'
export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple'
export type NormalisedRect = [number, number, number, number]

export const ANNOTATION_COLORS: AnnotationColor[] = ['yellow', 'green', 'blue', 'pink', 'purple']
export const ANNOTATION_SWATCH: Record<AnnotationColor, string> = {
  yellow: '#facd5a',
  green: '#8cdb94',
  blue: '#7ac0fa',
  pink: '#faa1c7',
  purple: '#c7aefa',
}

export type ReadingTextSelector =
  | { type: 'TextQuoteSelector'; exact: string; prefix?: string; suffix?: string }
  | { type: 'TextPositionSelector'; start: number; end: number }

export interface AnnotationItem {
  annotation_id: string
  locator: number
  material_revision?: number
  kind: AnnotationKind
  color: string
  quote: string
  note: string
  rects: NormalisedRect[]
  source_anchor: string
  selectors?: ReadingTextSelector[]
  resolution?: 'resolved' | 'unresolved' | 'ambiguous'
  author: string
  created_at: number
  updated_at: number
}

export interface AnnotationDraft {
  annotation_id?: string
  locator: number
  kind?: AnnotationKind
  color?: string
  quote?: string
  note?: string
  rects?: NormalisedRect[]
  source_anchor?: string
  selectors?: ReadingTextSelector[]
}

export async function listAnnotations(materialId: string): Promise<AnnotationItem[]> {
  return api<AnnotationItem[]>(`/api/reading/materials/${encodeURIComponent(materialId)}/annotations`)
}

export async function saveAnnotation(materialId: string, draft: AnnotationDraft): Promise<AnnotationItem> {
  return api<AnnotationItem>(`/api/reading/materials/${encodeURIComponent(materialId)}/annotations`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  })
}

export async function deleteAnnotation(materialId: string, annotationId: string): Promise<void> {
  await api(`/api/reading/materials/${encodeURIComponent(materialId)}/annotations/${encodeURIComponent(annotationId)}`, {
    method: 'DELETE',
  })
}

export function annotationsForLocator(items: AnnotationItem[], locator: number): AnnotationItem[] {
  return items.filter(item => item.locator === locator)
}

export function annotationColor(value: string): AnnotationColor {
  return (ANNOTATION_COLORS as string[]).includes(value) ? (value as AnnotationColor) : 'yellow'
}
