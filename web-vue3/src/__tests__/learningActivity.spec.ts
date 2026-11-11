import { beforeEach, describe, expect, it } from 'vitest'
import { allLearningActivity, learningTodos, type LearningSources } from '../learningActivity'

const sources: LearningSources = {
  books: [{ id: 'b1', title: 'Book', status: 'paused', updated_at: 20, created_at: 10, reading: { percent: 50 }, metadata: { pause_reason: 'quota' } }],
  mastery: [{ path_id: 'p1', name: 'Topic', updated_at: 30, metadata: { status: 'active', goal: 'Goal', created_at: 10 }, map: { counts: { total: 4, mastered: 1 } }, reviews: [{ due: true, knowledge_point_name: 'Vectors' }] }],
  reading: [{ workspace_id: 'r1', title: 'Collection', updated_at: 10 }],
  watching: [{ session_id: 'w1', title: 'Video', updated_at: 40, preferences: { workspace_mode: 'immersive_watching' } }],
  practice: [{ id: 7, question: 'Question', updated_at: 50, created_at: 20 }],
}

describe('learning activity', () => {
  beforeEach(() => { window.history.replaceState({}, '', '/'); sessionStorage.clear(); localStorage.clear() })

  it('normalizes, sorts and routes all learning surfaces', () => {
    const rows = allLearningActivity(sources)
    expect(rows.map(row => row.kind)).toEqual(['practice', 'watching', 'mastery', 'books', 'reading'])
    expect(rows.find(row => row.kind === 'mastery')?.progress).toBe(0.25)
    expect(rows.find(row => row.kind === 'books')?.progress).toBe(0.5)
    expect(rows.find(row => row.kind === 'watching')?.href).toContain('/learning/watching/w1')
  })

  it('only includes active due reviews and unfinished books as todos', () => {
    const todos = learningTodos(sources)
    expect(todos.reviews).toHaveLength(1)
    expect(todos.books).toHaveLength(1)
    expect(learningTodos({ ...sources, mastery: [{ ...sources.mastery[0], metadata: { status: 'archived' } }] }).reviews).toHaveLength(0)
  })
})
