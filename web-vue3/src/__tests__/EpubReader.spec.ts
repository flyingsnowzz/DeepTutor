import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import EpubReader from '../components/EpubReader.vue'

vi.mock('epubjs', () => ({
  default: vi.fn(() => ({
    ready: Promise.resolve(),
    spine: { get: vi.fn(() => ({ href: 'chapter1.xhtml' })) },
    locations: { generate: vi.fn(() => Promise.resolve()) },
    renderTo: vi.fn(() => ({
      display: vi.fn(() => Promise.resolve()),
      destroy: vi.fn(),
      on: vi.fn(),
      themes: {
        registerCss: vi.fn(),
        select: vi.fn(),
      },
      spread: vi.fn(),
      annotations: { highlight: vi.fn() },
      hooks: { content: { register: vi.fn() } },
      next: vi.fn(),
      prev: vi.fn(),
    })),
    destroy: vi.fn(),
  })),
}))

describe('EpubReader', () => {
  it('shows a loading/error shell for an unavailable document', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) }))
    const wrapper = mount(EpubReader, { props: { url: '/files/book.epub' } })
    await Promise.resolve()
    expect(wrapper.find('.epub-reader').exists()).toBe(true)
    expect(wrapper.find('.epub-rendition').exists()).toBe(true)
  })
})
