import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ContextReferenceTree from '../components/ContextReferenceTree.vue'

const items = [
  { key: 'book-b1', icon: 'book', kind: '书籍', label: 'Calculus（1）' },
  { key: 'q-1', icon: 'questions', kind: '题库', label: '题库题目（1）' },
  { key: 'hist-s1', icon: 'history', kind: '历史', label: 'Vector history' },
  { key: 'mem-summary', icon: 'memory', kind: '记忆', label: '摘要' },
  { key: 'file-1', icon: 'document', kind: '附件', label: 'notes.txt' },
]

describe('ContextReferenceTree', () => {
  it('collapses multi-item references and expands to the legacy rows', async () => {
    const wrapper = mount(ContextReferenceTree, {
      props: { items, summaryNoun: '项引用' },
      global: { stubs: { LegacyIcon: true } },
    })
    expect(wrapper.text()).toContain('5 项引用')
    expect(wrapper.findAll('.context-reference-row')).toHaveLength(0)
    await wrapper.get('.context-reference-summary').trigger('click')
    expect(wrapper.findAll('.context-reference-row')).toHaveLength(5)
    expect(wrapper.text()).toContain('Vector history')
  })

  it('emits preview and remove actions without nesting interactive buttons', async () => {
    const wrapper = mount(ContextReferenceTree, {
      props: { items: [items[0]!] },
      global: { stubs: { LegacyIcon: true } },
    })
    await wrapper.get('.context-reference-open').trigger('click')
    expect(wrapper.emitted('preview')?.[0]?.[0]).toMatchObject({ key: 'book-b1' })
    await wrapper.get('.context-reference-remove').trigger('click')
    expect(wrapper.emitted('remove')?.[0]?.[0]).toMatchObject({ key: 'book-b1' })
  })
})
