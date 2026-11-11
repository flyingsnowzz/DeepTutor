import { describe, expect, it } from 'vitest'
import {
  isQuoteAttachment,
  quoteAttachment,
  quoteText,
} from '../quoteAttachments'

describe('quote attachments', () => {
  it('round-trips UTF-8 quotes and clips oversized passages', () => {
    const quote = quoteAttachment('解释 **这段** 文字')
    expect(quote).not.toBeNull()
    expect(quoteText(quote!)).toBe('解释 **这段** 文字')
    expect(isQuoteAttachment(quote)).toBe(true)
    expect(quoteAttachment(' '.repeat(20))).toBeNull()
  })
})
