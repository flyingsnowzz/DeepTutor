import { describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import {
  ANNOTATION_COLORS,
  annotationColor,
  annotationsForLocator,
  deleteAnnotation,
  listAnnotations,
  saveAnnotation,
  type AnnotationItem,
} from '../readingAnnotations'

vi.mock('../api', () => ({ api: vi.fn() }))

const item: AnnotationItem = {
  annotation_id: 'a1',
  locator: 2,
  kind: 'highlight',
  color: 'blue',
  quote: 'DeepTutor',
  note: '',
  rects: [[0.1, 0.2, 0.4, 0.3]],
  source_anchor: '',
  author: 'user',
  created_at: 1,
  updated_at: 1,
}

describe('reading annotations', () => {
  it('exposes the backend palette and normalizes unknown colors', () => {
    expect(ANNOTATION_COLORS).toHaveLength(5)
    expect(annotationColor('unknown')).toBe('yellow')
    expect(annotationColor('green')).toBe('green')
  })

  it('groups annotations by reading locator', () => {
    expect(annotationsForLocator([item, { ...item, annotation_id: 'a2', locator: 3 }], 2)).toEqual([item])
  })

  it('calls the shared reading annotation endpoints', async () => {
    vi.mocked(api).mockResolvedValueOnce([item]).mockResolvedValueOnce(item).mockResolvedValueOnce(undefined)
    await expect(listAnnotations('mat1')).resolves.toEqual([item])
    await saveAnnotation('mat1', { locator: 1, quote: 'x' })
    await deleteAnnotation('mat1', 'a1')
    expect(api).toHaveBeenNthCalledWith(1, '/api/reading/materials/mat1/annotations')
    expect(api).toHaveBeenNthCalledWith(3, '/api/reading/materials/mat1/annotations/a1', { method: 'DELETE' })
  })
})
