import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MarkdownView from '../MarkdownView.vue'

describe('MarkdownView', () => {
  it('renders markdown and strips frontmatter without allowing script injection', () => {
    const wrapper = mount(MarkdownView, { props: { content: '---\nname: test\n---\n# Heading\n\n**safe**<img src=x onerror="alert(1)"><script>alert(1)</script>', stripFrontmatter: true } })
    expect(wrapper.find('h1').text()).toBe('Heading')
    expect(wrapper.find('strong').text()).toBe('safe')
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('onerror')
    expect(wrapper.text()).not.toContain('name: test')
  })
})
