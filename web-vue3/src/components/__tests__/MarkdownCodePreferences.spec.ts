import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MarkdownView from '../MarkdownView.vue'
import { setCodeBlockPreferences } from '../../codeBlockPreferences'

vi.mock('../../api', () => ({ api: vi.fn(async () => ({ ui: { code_block_theme: 'oneDark', code_block_show_line_numbers: true, code_block_wrap_long_lines: false } })) }))

describe('markdown code preferences', () => {
  beforeEach(() => setCodeBlockPreferences({ theme: 'oneDark', showLineNumbers: true, wrapLongLines: false }))

  it('renders fenced code with syntax colors and follows applied display preferences', async () => {
    const wrapper = mount(MarkdownView, { props: { content: '```python\ndef answer():\n    return 42\n```' } })
    await flushPromises()
    expect(wrapper.find('.code-block-content span[style]').exists()).toBe(true)
    expect(wrapper.findAll('.code-block-number').length).toBeGreaterThan(0)
    const initialBackground = wrapper.find('.code-block-preview').attributes('style')
    setCodeBlockPreferences({ theme: 'prism', showLineNumbers: false, wrapLongLines: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.code-block-preview').attributes('style')).not.toBe(initialBackground)
    expect(wrapper.findAll('.code-block-number')).toHaveLength(0)
    expect(wrapper.find('pre').classes()).toContain('wrap')
  })
})
