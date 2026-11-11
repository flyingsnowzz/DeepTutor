import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LearningBlocks from '../LearningBlocks.vue'
import { post } from '../../api'

vi.mock('../../api', () => ({ post: vi.fn() }))
const postMock = vi.mocked(post)
const quizBlock = { id: 'q1', type: 'learning', props: { kind: 'quiz', data: JSON.stringify({ questions: [{ question_id: 'q1:1', question: 'A?', options: { A: 'Yes', B: 'No' }, correct_answer: 'A', explanation: '' }] }) }, content: [], children: [] }

describe('LearningBlocks', () => {
  beforeEach(() => { postMock.mockReset(); postMock.mockResolvedValue({}) })

  it('records a quiz attempt in the block and question bank', async () => {
    const wrapper = mount(LearningBlocks, { props: { blocks: [quizBlock], documentId: 'doc1', documentTitle: 'Doc' } })
    await wrapper.get('input[type="radio"]').setValue(true)
    await wrapper.get('button').trigger('click')
    await flushPromises()
    const updated = wrapper.emitted('updateBlock')?.[0][0] as any
    expect(JSON.parse(updated.props.data).attempts[0]).toMatchObject({ question_id: 'q1:1', user_answer: 'A', is_correct: true })
    expect(postMock).toHaveBeenCalledWith('/api/question-notebook/entries/upsert', expect.objectContaining({ question_id: 'q1:1', is_correct: true, material_title: 'Doc' }))
    expect(wrapper.text()).toContain('回答正确')
  })

  it('reveals flashcard answers', async () => {
    const block = { ...quizBlock, props: { kind: 'flashcards', data: JSON.stringify({ cards: [{ front: 'Front', back: 'Back' }] }) } }
    const wrapper = mount(LearningBlocks, { props: { blocks: [block], documentId: 'doc1', documentTitle: 'Doc' } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.text()).toContain('Back')
  })
})
