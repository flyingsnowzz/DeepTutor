/**
 * Quiz answer state + local grading — Vue3 port of the pure helpers inside
 * web/components/quiz/QuizViewer.tsx (getQuestionKey / isMultipleChoice /
 * isAutoGradable / getUserAnswer / isAnswerCorrect).
 */
import {
  isChoiceQuizQuestion,
  isConceptQuizQuestion,
  isFillInBlankQuizQuestion,
  resolveChoiceAnswerKey,
  resolveConceptAnswer,
} from './questionType'
import type { QuizQuestion } from './quizModel'

export interface QuizAnswerImage {
  id: string
  url: string
  filename: string
  mime_type: string
  /** Base64 payload for a freshly-picked image (no data: prefix). */
  base64?: string | null
}

export interface AnswerState {
  selected: string | null
  typed: string
  submitted: boolean
  images: QuizAnswerImage[]
}

export const EMPTY_ANSWER: AnswerState = {
  selected: null,
  typed: '',
  submitted: false,
  images: [],
}

export interface JudgmentState {
  text: string
  isStreaming: boolean
  error: string | null
}

export const EMPTY_JUDGMENT: JudgmentState = {
  text: '',
  isStreaming: false,
  error: null,
}

export type AnswerView = 'reference' | 'judgment'

export function getQuestionKey(question: QuizQuestion, index: number): string {
  return question.question_id || `question_${index + 1}`
}

/** A choice question is only multiple-choice when it actually has options. */
export function isMultipleChoice(question: QuizQuestion): boolean {
  return (
    isChoiceQuizQuestion(question.question_type) &&
    !!question.options &&
    Object.keys(question.options).length > 0
  )
}

/**
 * Auto-gradable types: multiple choice, concept (T/F), fill-in-the-blank.
 * Open-ended types (short_answer, written, coding) are learner-graded.
 */
export function isAutoGradable(question: QuizQuestion): boolean {
  return (
    isMultipleChoice(question) ||
    isConceptQuizQuestion(question.question_type) ||
    isFillInBlankQuizQuestion(question.question_type)
  )
}

/** Choice/concept use `selected`; fill-in-blank and free text use trimmed `typed`. */
export function getUserAnswer(question: QuizQuestion, answer: AnswerState): string {
  if (isMultipleChoice(question) || isConceptQuizQuestion(question.question_type)) {
    return answer.selected ?? ''
  }
  return answer.typed.trim()
}

/** Exact-match grader for auto-gradable question types. */
export function isAnswerCorrect(question: QuizQuestion, answer: AnswerState): boolean {
  const userAnswer = getUserAnswer(question, answer)
  if (!userAnswer) return false
  const correct = question.correct_answer.trim()
  if (isMultipleChoice(question)) {
    const correctChoiceKey = resolveChoiceAnswerKey(correct, question.options)
    return (
      userAnswer.toUpperCase() === correctChoiceKey ||
      userAnswer.toUpperCase() === correct.toUpperCase() ||
      userAnswer.toUpperCase() === correct.charAt(0).toUpperCase()
    )
  }
  if (isConceptQuizQuestion(question.question_type)) {
    const correctTF = resolveConceptAnswer(correct)
    return userAnswer.toLowerCase() === correctTF
  }
  return userAnswer.toLowerCase() === correct.toLowerCase()
}

/** Whether the learner has supplied anything that can be submitted. */
export function hasAnswer(question: QuizQuestion, answer: AnswerState): boolean {
  if (answer.images.length > 0) return true
  return getUserAnswer(question, answer).length > 0
}

/** Count submitted, auto-graded questions and how many were correct. */
export function answerSummary(
  questions: QuizQuestion[],
  answers: Record<number, AnswerState>,
): { answered: number; graded: number; correct: number } {
  let answered = 0
  let graded = 0
  let correct = 0
  questions.forEach((question, index) => {
    const answer = answers[index]
    if (!answer || !answer.submitted) return
    answered += 1
    if (!isAutoGradable(question)) return
    graded += 1
    if (isAnswerCorrect(question, answer)) correct += 1
  })
  return { answered, graded, correct }
}

/** Generate the short image id used by the React viewer (no dashes, 12 chars). */
export function makeAnswerImageId(uuid: string): string {
  return uuid.replaceAll('-', '').slice(0, 12)
}
