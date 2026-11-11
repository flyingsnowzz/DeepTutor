<script setup lang="ts">
/**
 * Quiz session viewer — Vue3 port of the container behaviour of
 * web/components/quiz/QuizViewer.tsx: per-question navigation, progress,
 * answer state persistence, submit and retry. Rich per-question rendering is
 * delegated to QuizQuestionCard.
 */
import { computed, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import QuizQuestionCard from './QuizQuestionCard.vue'
import QuizFollowupPanel from './QuizFollowupPanel.vue'
import { EMPTY_ANSWER, answerSummary, type AnswerState } from '../quiz/answerState'
import {
  clampQuestionIndex,
  completedCount,
  navigationProgress,
  patchAnswer,
  resetAnswer,
  submittedResults,
} from '../quiz/quizSession'
import type { QuizQuestion } from '../quiz/quizModel'

const props = withDefaults(defineProps<{
  questions: QuizQuestion[]
  title?: string
  initialIndex?: number
  sessionId?: string | null
  turnId?: string | null
  language?: string | null
}>(), { title: '随堂练习', initialIndex: 0 })

const emit = defineEmits<{
  (event: 'submit', results: ReturnType<typeof submittedResults>): void
  (event: 'change', index: number): void
}>()

const idx = ref(0)
const answers = ref<Record<number, AnswerState>>({})
const followupOpen = ref(false)

watch(
  () => [props.questions.length, props.initialIndex] as const,
  () => {
    const clamped = clampQuestionIndex(props.initialIndex, props.questions.length)
    idx.value = clamped ?? 0
    answers.value = {}
    followupOpen.value = false
  },
  { immediate: true },
)

const total = computed(() => props.questions.length)
const current = computed<QuizQuestion | undefined>(() => props.questions[idx.value])
const currentAnswer = computed<AnswerState>(() => answers.value[idx.value] ?? EMPTY_ANSWER)
const progress = computed(() => navigationProgress(idx.value, total.value))
const completed = computed(() => completedCount(answers.value))
const summary = computed(() => answerSummary(props.questions, answers.value))
const isLast = computed(() => total.value === 0 || idx.value >= total.value - 1)
const allDone = computed(() => total.value > 0 && completed.value === total.value)

function goTo(target: number) {
  const clamped = clampQuestionIndex(target, total.value)
  if (clamped === null) return
  idx.value = clamped
  followupOpen.value = false
  emit('change', clamped)
}

function onUpdateAnswer(answer: AnswerState) {
  answers.value = patchAnswer(answers.value, idx.value, answer)
}

function onSubmitAnswer(answer: AnswerState) {
  answers.value = patchAnswer(answers.value, idx.value, answer)
  if (isLast.value) {
    emit('submit', submittedResults(props.questions, answers.value))
  } else {
    goTo(idx.value + 1)
  }
}

function retryCurrent() {
  answers.value = resetAnswer(answers.value, idx.value)
  followupOpen.value = false
}

function submitAll() {
  emit('submit', submittedResults(props.questions, answers.value))
}

defineExpose({ goTo, submitAll, answers })
</script>

<template>
  <section class="quiz-viewer">
    <header class="quiz-viewer-head">
      <div>
        <h3>{{ title }}</h3>
        <p>{{ completed }} / {{ total }} 已作答<template v-if="summary.graded"> · {{ summary.correct }}/{{ summary.graded }} 正确</template></p>
      </div>
      <div class="quiz-viewer-nav">
        <button type="button" aria-label="上一题" :disabled="idx === 0" @click="goTo(idx - 1)">
          <LegacyIcon name="chevronLeft" :size="16" />
        </button>
        <span>{{ idx + 1 }} / {{ total }}</span>
        <button type="button" aria-label="下一题" :disabled="isLast" @click="goTo(idx + 1)">
          <LegacyIcon name="chevronRight" :size="16" />
        </button>
      </div>
    </header>

    <div class="quiz-viewer-progress" role="progressbar" :aria-valuenow="Math.round(progress)" aria-valuemin="0" aria-valuemax="100">
      <span :style="{ width: `${progress}%` }" />
    </div>

    <div v-if="current" class="quiz-viewer-body">
      <QuizQuestionCard
        :question="current"
        :index="idx"
        :answer="currentAnswer"
        @update:answer="onUpdateAnswer"
        @submit="onSubmitAnswer"
      />
      <div class="quiz-viewer-actions">
        <button
          v-if="currentAnswer.submitted"
          type="button"
          class="quiz-viewer-retry"
          @click="retryCurrent"
        >
          重试本题
        </button>
        <button
          v-if="allDone"
          type="button"
          class="quiz-viewer-finish"
          @click="submitAll"
        >
          完成练习
        </button>
      </div>
      <button
        v-if="currentAnswer.submitted"
        type="button"
        class="quiz-followup-toggle"
        :aria-expanded="followupOpen"
        @click="followupOpen = !followupOpen"
      >
        <LegacyIcon name="chat" :size="12" />
        {{ followupOpen ? '收起追问' : '继续追问' }}
      </button>
      <KeepAlive>
        <QuizFollowupPanel
          v-if="followupOpen && current"
          :key="current.question_id"
          :question="current"
          :answer="currentAnswer"
          :parent-session-id="sessionId"
          :turn-id="turnId"
          :language="language"
        />
      </KeepAlive>
    </div>
    <p v-else class="quiz-viewer-empty">暂无题目。</p>
  </section>
</template>
