export const QUOTE_ATTACHMENT_TYPE = 'quote'
export const QUOTE_ATTACHMENT_FILENAME = 'quote.md'
export const MAX_QUOTE_LENGTH = 12_000

export interface QuotePendingAttachmentLike {
  type: 'quote'
  filename: string
  text: string
  base64: string
  mime_type: string
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function base64ToUtf8(value: string): string {
  try {
    const binary = atob(value)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}

export function quoteAttachment(text: string): QuotePendingAttachmentLike | null {
  const body = text.trim().slice(0, MAX_QUOTE_LENGTH)
  if (!body) return null
  return {
    type: QUOTE_ATTACHMENT_TYPE,
    filename: QUOTE_ATTACHMENT_FILENAME,
    text: body,
    base64: utf8ToBase64(body),
    mime_type: 'text/markdown',
  }
}

export function isQuoteAttachment(attachment: { type?: string } | null | undefined): boolean {
  return attachment?.type === QUOTE_ATTACHMENT_TYPE
}

export function quoteText(attachment: {
  type?: string
  text?: string
  base64?: string
  extracted_text?: string
}): string {
  if (attachment.text) return attachment.text
  if (attachment.extracted_text) return attachment.extracted_text
  return attachment.base64 ? base64ToUtf8(attachment.base64) : ''
}
