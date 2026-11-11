const OUTPUT_SIZE = 256
export const MAX_AVATAR_SOURCE_BYTES = 20 * 1024 * 1024

/** Center-crop, downscale and re-encode so uploads discard EXIF and oversized sources. */
export async function cropAvatarToSquare(file: File): Promise<Blob> {
  if (file.size > MAX_AVATAR_SOURCE_BYTES) throw new Error('图片不能超过 20 MB')
  let source: CanvasImageSource
  let width: number
  let height: number
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    source = bitmap
    width = bitmap.width
    height = bitmap.height
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image()
        element.onload = () => resolve(element)
        element.onerror = () => reject(new Error('无法解码图片'))
        element.src = url
      })
      source = image
      width = image.naturalWidth
      height = image.naturalHeight
    } finally { URL.revokeObjectURL(url) }
  }
  if (!width || !height) throw new Error('无法解码图片')
  const side = Math.min(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法处理图片')
  context.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close()
  const toBlob = (type: string, quality?: number) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality))
  const blob = await toBlob('image/webp', 0.85) ?? await toBlob('image/png')
  if (!blob) throw new Error('无法编码图片')
  return blob
}
