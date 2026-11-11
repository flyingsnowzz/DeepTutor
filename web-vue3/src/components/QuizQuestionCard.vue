<script setup lang="ts">
/**
 * Single quiz question card — Vue3 port of the question body of
 * web/components/quiz/QuizViewer.tsx (choice / concept / fill-in-blank /
 * free-text interactions, submitted feedback and explanation).
 *
 * Answer state is owned by the parent; this component only edits and
 * emits, so a multi-question viewer can persist all answers together.
 */
import { computed } from 'vue'
import MarkdownView from './MarkdownView.vue'
import { isMultipleChoice, isAutoGradable, isAnswerCorrect, type AnswerState } from '../quiz/answerState'
import { isConceptQuizQuestion, isFillInBlankQuizQuestion, resolveConceptAnswer, resolveChoiceAnswerKey } from '../quiz/questionType'
import type { QuizQuestion } from '../quiz/quizModel'

const props = defineProps<{
  question: QuizQuestion
  index: number
  answer: AnswerState
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:answer', value: AnswerState): void
  (event: 'submit', value: AnswerState): void
}>()

const choice = computed(() => isMultipleChoice(props.question))
const concept = computed(() => isConceptQuizQuestion(props.question.question_type))
const fillBlank = computed(() => isFillInBlankQuizQuestion(props.question.question_type))
const autoGradable = computed(() => isAutoGradable(props.question))
const submitted = computed(() => props.answer.submitted)
const correct = computed(() => submitted.value && autoGradable.value && isAnswerCorrect(props.question, props.answer))
const options = computed(() => Object.entries(props.question.options ?? {}))
const correctChoiceKey = computed(() => resolveChoiceAnswerKey(props.question.correct_answer, props.question.options))
const correctConcept = computed(() => resolveConceptAnswer(props.question.correct_answer))
const canSubmit = computed(() => {
  if (props.answer.images.length > 0) return true
  const text = choice.value || concept.value ? props.answer.selected ?? '' : props.answer.typed.trim()
  return text.length > 0
})

function patch(update: Partial<AnswerState>) {
  if (submitted.value || props.disabled) return
  emit('update:answer', { ...props.answer, ...update })
}

function submit() {
  if (!canSubmit.value || submitted.value || props.disabled) return
  emit('submit', { ...props.answer, submitted: true })
}

function optionClass(key: string): string {
  const selected = props.answer.selected === key
  const isCorrect = key.toUpperCase() === correctChoiceKey.value
  if (!submitted.value && selected) return 'is-selected'
  if (submitted.value && isCorrect) return 'is-correct'
  if (submitted.value && selected && !isCorrect) return 'is-wrong'
  return ''
}

function conceptClass(key: 'true' | 'false'): string {
  const selected = props.answer.selected === key
  const isCorrect = key === correctConcept.value
  if (!submitted.value && selected) return 'is-selected'
  if (submitted.value && isCorrect) return 'is-correct'
  if (submitted.value && selected && !isCorrect) return 'is-wrong'
  return ''
}
</script>

<template>
  <article class="quiz-question-card">
    <header class="quiz-question-head">
      <span class="quiz-question-index">{{ index + 1 }}</span>
      <span class="quiz-question-type">{{ question.question_type }}</span>
    </header>

    <div class="quiz-question-stem">
      <MarkdownView :content="question.question" />
    </div>

    <div v-if="choice" class="quiz-options">
      <button
        v-for="[key, text] in options"
        :key="key"
        type="button"
        class="quiz-option"
        :class="optionClass(key)"
        :disabled="submitted || disabled"
        @click="patch({ selected: key })"
      >
        <span class="quiz-option-key">{{ submitted && key.toUpperCase() === correctChoiceKey ? '✓' : key }}</span>
        <span class="quiz-option-text"><MarkdownView :content="text" /></span>
      </button>
    </div>

    <div v-else-if="concept" class="quiz-options quiz-options-tf">
      <button
        v-for="key in (['true', 'false'] as const)"
        :key="key"
        type="button"
        class="quiz-option quiz-option-tf"
        :class="conceptClass(key)"
        :disabled="submitted || disabled"
        @click="patch({ selected: key })"
      >
        {{ key === 'true' ? '正确（True）' : '错误（False）' }}
      </button>
    </div>

    <input
      v-else-if="fillBlank"
      class="quiz-answer-input"
      type="text"
      :value="answer.typed"
      :disabled="submitted || disabled"
      placeholder="填写答案"
      aria-label="填空题答案"
      @input="patch({ typed: ($event.target as HTMLInputElement).value })"
    >

    <textarea
      v-else
      class="quiz-answer-input quiz-answer-textarea"
      :value="answer.typed"
      :disabled="submitted || disabled"
      rows="4"
      placeholder="写下你的答案"
      aria-label="简答题答案"
      @input="patch({ typed: ($event.target as HTMLTextAreaElement).value })"
    />

    <footer class="quiz-question-foot">
      <button v-if="!submitted" type="button" class="quiz-submit" :disabled="!canSubmit || disabled" @click="submit">
        提交答案
      </button>
      <span v-else-if="autoGradable" class="quiz-result" :class="correct ? 'is-correct' : 'is-wrong'">
        {{ correct ? '回答正确' : '回答错误' }}
      </span>
      <span v-else class="quiz-result is-manual">已提交 · 请对照参考答案自评</span>
    </footer>

    <details v-if="submitted && question.explanation" class="quiz-explanation">
      <summary>查看解析</summary>
      <MarkdownView :content="question.explanation" />
    </details>

    <p v-if="submitted && question.correct_answer" class="quiz-correct-answer">
      参考答案：<MarkdownView :content="question.correct_answer" />
    </p>
  </article>
</template>
