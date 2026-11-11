/**
 * Quiz session navigation + submission helpers — Vue3 port of the pure
 * state derivations in web/components/quiz/QuizViewer.tsx
 * (navigationProgress / completedCount / submittedResults / reset semantics).
 */
import {
  EMPTY_ANSWER,
  getUserAnswer,
  isAnswerCorrect,
  type AnswerState,
} from './answerState'
import type { QuizQuestion } from './quizModel'

export interface SubmittedQuizResult {
  question_id: string
  question: string
  question_type: string
  options: Record<string, string>
  user_answer: string
  correct_answer: string
  explanation: string
  difficulty: string
  is_correct: boolean
}

/** Percentage through the quiz (1-based index), 0 when empty. */
export function navigationProgress(index: number, total: number): number {
  return total > 0 ? ((index + 1) / total) * 100 : 0
}

/** Number of submitted answers in the session. */
export function completedCount(answers: Record<number, AnswerState>): number {
  return Object.values(answers).filter(answer => answer.submitted).length
}

/** Apply a partial patch to one question's answer, preserving other fields. */
export function patchAnswer(
  answers: Record<number, AnswerState>,
  index: number,
  patch: Partial<AnswerState>,
): Record<number, AnswerState> {
  return {
    ...answers,
    [index]: { ...(answers[index] ?? EMPTY_ANSWER), ...patch },
  }
}

/**
 * Reset a question's answer for retry. Mirrors React: clear selection and
 * typed text and un-submit, but keep attached images so the learner does not
 * have to re-upload them.
 */
export function resetAnswer(answers: Record<number, AnswerState>, index: number): Record<number, AnswerState> {
  const current = answers[index] ?? EMPTY_ANSWER
  return {
    ...answers,
    [index]: { ...current, selected: null, typed: '', submitted: false },
  }
}

/** Whether the current answer is correct (only meaningful once submitted). */
export function showCorrectness(
  question: QuizQuestion | undefined,
  answer: AnswerState | undefined,
): boolean | null {
  if (!question || !answer?.submitted) return null
  const userAnswer = getUserAnswer(question, answer)
  if (!userAnswer) return null
  return isAnswerCorrect(question, answer)
}

/** Flatten every submitted answer into the notebook result shape. */
export function submittedResults(
  questions: QuizQuestion[],
  answers: Record<number, AnswerState>,
): SubmittedQuizResult[] {
  const results: SubmittedQuizResult[] = []
  questions.forEach((question, index) => {
    const answer = answers[index]
    if (!answer?.submitted) return
    results.push({
      question_id: question.question_id,
      question: question.question,
      question_type: question.question_type,
      options: question.options ?? {},
      user_answer: getUserAnswer(question, answer),
      correct_answer: question.correct_answer,
      explanation: question.explanation ?? '',
      difficulty: question.difficulty ?? '',
      is_correct: isAnswerCorrect(question, answer),
    })
  })
  return results
}

/** Clamp a navigation target into [0, total-1]; null when empty. */
export function clampQuestionIndex(index: number, total: number): number | null {
  if (total <= 0) return null
  return Math.max(0, Math.min(index, total - 1))
}
