import type { NormalisedRect } from './readingAnnotations'

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

const MIN_RECT_PX = 2
const SAME_LINE_OVERLAP = 0.5

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function mergeRectsByLine(rects: Box[]): Box[] {
  const usable = rects.filter(rect => rect.width >= MIN_RECT_PX && rect.height >= MIN_RECT_PX)
  if (!usable.length) return []
  const sorted = [...usable].sort((a, b) => a.top - b.top || a.left - b.left)
  const lines: Box[][] = []
  for (const rect of sorted) {
    const line = lines.find(candidate => {
      const probe = candidate[0]
      if (!probe) return false
      const overlap = Math.min(probe.top + probe.height, rect.top + rect.height) - Math.max(probe.top, rect.top)
      const shorter = Math.min(probe.height, rect.height)
      return shorter > 0 && overlap / shorter >= SAME_LINE_OVERLAP
    })
    if (line) line.push(rect)
    else lines.push([rect])
  }
  return lines.map(line => {
    const left = Math.min(...line.map(rect => rect.left))
    const top = Math.min(...line.map(rect => rect.top))
    const right = Math.max(...line.map(rect => rect.left + rect.width))
    const bottom = Math.max(...line.map(rect => rect.top + rect.height))
    return { left, top, width: right - left, height: bottom - top }
  })
}

export function normaliseRects(rects: Box[], container: Box): NormalisedRect[] {
  if (container.width <= 0 || container.height <= 0) return []
  return mergeRectsByLine(rects)
    .map(rect => {
      const x0 = clamp01((rect.left - container.left) / container.width)
      const y0 = clamp01((rect.top - container.top) / container.height)
      const x1 = clamp01((rect.left + rect.width - container.left) / container.width)
      const y1 = clamp01((rect.top + rect.height - container.top) / container.height)
      return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)] as NormalisedRect
    })
    .filter(([x0, y0, x1, y1]) => x1 - x0 > 0.001 && y1 - y0 > 0.001)
}

export function unionRect(rects: NormalisedRect[]): NormalisedRect | null {
  if (!rects.length) return null
  return [
    Math.min(...rects.map(rect => rect[0])),
    Math.min(...rects.map(rect => rect[1])),
    Math.max(...rects.map(rect => rect[2])),
    Math.max(...rects.map(rect => rect[3])),
  ]
}

export function cleanQuote(raw: string, limit = 2000): string {
  const flat = (raw || '').replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : flat.slice(0, limit)
}

export function rangeClientRects(range: Range): Box[] {
  return Array.from(range.getClientRects()).map(rect => ({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }))
}

export function elementBox(element: HTMLElement): Box {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}
