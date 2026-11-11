<script setup lang="ts">
/**
 * Quiz generation settings — Vue3 port of web/components/quiz/QuizConfigPanel.tsx.
 * Emits a fully reconciled config on every change so parents always see a
 * valid per-type distribution.
 */
import { computed } from 'vue'
import {
  clampQuestionCount,
  isQuizConfigSubmittable,
  QUIZ_DIFFICULTIES,
  QUIZ_TYPE_ACCENT,
  reconcileQuizConfig,
  toggleQuestionType,
  totalTypeCount,
  typePercentages,
} from '../quiz/quizConfig'
import { QUIZ_QUESTION_TYPES, type NormalizedQuizQuestionType } from '../quiz/questionType'
import { QUIZ_TYPE_LABEL_KEYS, summarizeQuizConfig, type DeepQuestionFormConfig } from '../quiz/quizModel'

const props = defineProps<{
  modelValue: DeepQuestionFormConfig
  collapsed?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: DeepQuestionFormConfig): void
}>()

const TYPE_LABELS: Record<NormalizedQuizQuestionType, string> = {
  choice: '选择题',
  concept: '判断题',
  fill_in_blank: '填空题',
  short_answer: '简答题',
  written: '论述题',
  coding: '编程题',
}

const summary = computed(() => summarizeQuizConfig(props.modelValue))
const showRatio = computed(() => props.modelValue.mode === 'custom' && props.modelValue.question_types.length >= 2)
const totalCount = computed(() => totalTypeCount(props.modelValue.question_types, props.modelValue.per_type_counts))
const percentages = computed(() => typePercentages(props.modelValue.question_types, props.modelValue.per_type_counts))
const canSubmit = computed(() => isQuizConfigSubmittable(props.modelValue))

function apply(next: DeepQuestionFormConfig) {
  emit('update:modelValue', reconcileQuizConfig(next))
}

function setMode(mode: DeepQuestionFormConfig['mode']) {
  apply({ ...props.modelValue, mode })
}

function setCount(value: string) {
  const count = clampQuestionCount(Number(value), props.modelValue.mode)
  apply({ ...props.modelValue, num_questions: count })
}

function setMimicMax(value: string) {
  const count = clampQuestionCount(Number(value), 'mimic')
  apply({ ...props.modelValue, max_questions: count })
}

function setDifficulty(value: string) {
  apply({ ...props.modelValue, difficulty: value })
}

function toggleType(type: NormalizedQuizQuestionType) {
  apply({ ...props.modelValue, question_types: toggleQuestionType(props.modelValue.question_types, type) })
}

function setTypeCount(type: NormalizedQuizQuestionType, value: string, event: Event) {
  const input = event.target as HTMLInputElement
  const raw = Number(value)
  const nextCount = Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 1
  input.value = String(nextCount)
  apply({
    ...props.modelValue,
    per_type_counts: { ...props.modelValue.per_type_counts, [type]: nextCount },
  })
}

function setPaper(event: Event) {
  apply({ ...props.modelValue, paper_path: (event.target as HTMLInputElement).value })
}
</script>

<template>
  <section class="quiz-config-panel" :class="{ 'is-collapsed': collapsed }">
    <header class="quiz-config-head">
      <h4>出题设置</h4>
      <span class="quiz-config-summary">{{ summary }}</span>
    </header>

    <div class="quiz-mode-toggle" role="tablist" aria-label="出题模式">
      <button type="button" role="tab" :aria-selected="modelValue.mode === 'custom'" :class="{ active: modelValue.mode === 'custom' }" @click="setMode('custom')">
        自定义
      </button>
      <button type="button" role="tab" :aria-selected="modelValue.mode === 'mimic'" :class="{ active: modelValue.mode === 'mimic' }" @click="setMode('mimic')">
        模仿试卷
      </button>
    </div>

    <template v-if="modelValue.mode === 'custom'">
      <div class="quiz-config-grid">
        <label class="quiz-config-field">
          <span>题目数量</span>
          <input type="number" min="1" max="20" :value="modelValue.num_questions" aria-label="题目数量" @change="setCount(($event.target as HTMLInputElement).value)">
        </label>
        <label class="quiz-config-field">
          <span>难度</span>
          <select :value="modelValue.difficulty" aria-label="难度" @change="setDifficulty(($event.target as HTMLSelectElement).value)">
            <option v-for="level in QUIZ_DIFFICULTIES" :key="level" :value="level">
              {{ level === 'auto' ? '自动' : level === 'easy' ? '简单' : level === 'medium' ? '中等' : '困难' }}
            </option>
          </select>
        </label>
      </div>

      <fieldset class="quiz-type-picker">
        <legend>允许的题型</legend>
        <div class="quiz-type-chips">
          <button
            v-for="type in QUIZ_QUESTION_TYPES"
            :key="type"
            type="button"
            class="quiz-type-chip"
            :class="{ active: modelValue.question_types.includes(type) }"
            :aria-pressed="modelValue.question_types.includes(type)"
            @click="toggleType(type)"
          >
            <span class="quiz-type-dot" :style="{ background: QUIZ_TYPE_ACCENT[type] }" />
            {{ TYPE_LABELS[type] }}
          </button>
        </div>
        <p class="quiz-type-hint">不选择题型时由规划器自动决定。</p>
      </fieldset>

      <div v-if="showRatio" class="quiz-ratio">
        <div class="quiz-ratio-bar" aria-hidden="true">
          <span
            v-for="row in percentages"
            :key="row.type"
            :style="{ width: `${row.percent}%`, background: QUIZ_TYPE_ACCENT[row.type] }"
          />
        </div>
        <div class="quiz-ratio-rows">
          <label v-for="row in percentages" :key="row.type" class="quiz-ratio-row">
            <span class="quiz-type-dot" :style="{ background: QUIZ_TYPE_ACCENT[row.type] }" />
            <span class="quiz-ratio-label">{{ TYPE_LABELS[row.type] }}</span>
            <input
              type="number"
              min="1"
              :value="modelValue.per_type_counts[row.type] ?? 1"
              :aria-label="`${TYPE_LABELS[row.type]}题目数量`"
              @change="setTypeCount(row.type, ($event.target as HTMLInputElement).value, $event)"
            >
          </label>
        </div>
        <p class="quiz-ratio-total">合计 {{ totalCount }} / {{ modelValue.num_questions }}</p>
      </div>
    </template>

    <template v-else>
      <label class="quiz-config-field quiz-config-field-wide">
        <span>试卷路径</span>
        <input type="text" :value="modelValue.paper_path" placeholder="选择或填写试卷路径" aria-label="试卷路径" @input="setPaper">
      </label>
      <label class="quiz-config-field">
        <span>最多题目数</span>
        <input type="number" min="1" max="50" :value="modelValue.max_questions" aria-label="最多题目数" @change="setMimicMax(($event.target as HTMLInputElement).value)">
      </label>
    </template>

    <p v-if="!canSubmit" class="quiz-config-warning">
      {{ modelValue.mode === 'mimic' ? '请先选择试卷。' : '题目数量至少为 1。' }}
    </p>
  </section>
</template>
