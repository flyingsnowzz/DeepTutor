<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import { buildAskUserReply, type AskUserCardData, type AskUserQuestion } from '../askUser'

const props = defineProps<{
  data: AskUserCardData
  disabled?: boolean
}>()
const emit = defineEmits<{
  submit: [payload: { text: string; answers: Array<{ questionId: string; text: string }> }]
}>()

const active = ref(0)
const picks = ref<Record<string, string[]>>({})
const customSelected = ref<Record<string, boolean>>({})
const customText = ref<Record<string, string>>({})
const sending = ref(false)

const questions = computed(() => props.data.payload.questions)
const activeQuestion = computed<AskUserQuestion | undefined>(() => questions.value[active.value])
const answers = computed(() => {
  const result: Record<string, string> = {}
  for (const question of questions.value) {
    const picked = picks.value[question.id] ?? []
    const custom = customSelected.value[question.id] ? (customText.value[question.id] ?? '').trim() : ''
    result[question.id] = question.multi_select
      ? [...picked, ...(custom ? [custom] : [])].join(', ')
      : customSelected.value[question.id]
        ? custom
        : (picked[0] ?? '')
  }
  return result
})
const canSubmit = computed(() =>
  !props.disabled &&
  !sending.value &&
  !props.data.streaming &&
  !props.data.resolved &&
  questions.value.every(question => (answers.value[question.id] ?? '').trim().length > 0),
)

function pick(question: AskUserQuestion, label: string) {
  if (question.multi_select) {
    const current = picks.value[question.id] ?? []
    picks.value = {
      ...picks.value,
      [question.id]: current.includes(label)
        ? current.filter(item => item !== label)
        : [...current, label],
    }
    return
  }
  picks.value = { ...picks.value, [question.id]: [label] }
  customSelected.value = { ...customSelected.value, [question.id]: false }
  if (questions.value.length > 1) {
    for (let step = 1; step < questions.value.length; step += 1) {
      const next = (active.value + step) % questions.value.length
      const questionId = questions.value[next]?.id
      if (questionId && !(answers.value[questionId] ?? '').trim()) {
        active.value = next
        break
      }
    }
  }
}

function chooseCustom(question: AskUserQuestion) {
  customSelected.value = { ...customSelected.value, [question.id]: true }
  if (!question.multi_select) picks.value = { ...picks.value, [question.id]: [] }
}

function updateCustom(question: AskUserQuestion, value: string) {
  customText.value = { ...customText.value, [question.id]: value }
  customSelected.value = { ...customSelected.value, [question.id]: true }
}

function skip() {
  if (!activeQuestion.value || props.disabled) return
  picks.value = { ...picks.value, [activeQuestion.value.id]: [] }
  customSelected.value = { ...customSelected.value, [activeQuestion.value.id]: false }
  customText.value = { ...customText.value, [activeQuestion.value.id]: '' }
  if (active.value < questions.value.length - 1) active.value += 1
  else submit(true)
}

function submit(allowIncomplete = false) {
  if (props.disabled || sending.value || props.data.streaming || props.data.resolved) return
  if (!allowIncomplete && !canSubmit.value) return
  sending.value = true
  emit('submit', buildAskUserReply(props.data.payload, answers.value))
}

function answeredText(questionId: string) {
  return props.data.answers?.find(answer => answer.questionId === questionId)?.text || '（未回答）'
}

watch(() => props.data.payload, () => {
  active.value = 0
  picks.value = {}
  customSelected.value = {}
  customText.value = {}
  sending.value = false
}, { deep: true })
</script>

<template>
  <section class="ask-user-card" :data-resolved="data.resolved || undefined">
    <header>
      <LegacyIcon name="questions" :size="14" />
      <strong>{{ data.resolved ? '已补充信息' : '需要你的选择' }}</strong>
      <span v-if="data.streaming">正在生成问题…</span>
    </header>
    <p v-if="data.payload.intro" class="ask-user-intro">{{ data.payload.intro }}</p>

    <div v-if="data.resolved" class="ask-user-resolved">
      <div v-for="question in questions" :key="question.id">
        <strong>{{ question.header || question.prompt }}</strong>
        <p>{{ answeredText(question.id) }}</p>
      </div>
    </div>

    <template v-else>
      <div v-if="questions.length > 1" class="ask-user-tabs" role="tablist" aria-label="问题">
        <button
          v-for="(question, index) in questions"
          :key="question.id"
          type="button"
          role="tab"
          :aria-selected="active === index"
          @click="active = index"
        >{{ question.header || `问题 ${index + 1}` }}</button>
      </div>

      <div v-if="activeQuestion" class="ask-user-question">
        <h3>{{ activeQuestion.prompt }}</h3>
        <div class="ask-user-options">
          <button
            v-for="option in activeQuestion.options"
            :key="option.label"
            type="button"
            :aria-pressed="(picks[activeQuestion.id] || []).includes(option.label)"
            :disabled="disabled || sending || data.streaming"
            @click="pick(activeQuestion, option.label)"
          >
            <span>{{ option.label }}</span>
            <small v-if="option.description">{{ option.description }}</small>
          </button>
        </div>
        <label v-if="activeQuestion.allow_free_text" class="ask-user-custom">
          <span>其他 / 补充说明</span>
          <textarea
            rows="2"
            :placeholder="activeQuestion.placeholder || '输入你的回答…'"
            :value="customText[activeQuestion.id] || ''"
            :disabled="disabled || sending || data.streaming"
            @focus="chooseCustom(activeQuestion)"
            @input="updateCustom(activeQuestion, ($event.target as HTMLTextAreaElement).value)"
          />
        </label>
      </div>

      <footer>
        <button type="button" class="ask-user-skip" :disabled="disabled || sending || data.streaming" @click="skip">
          跳过此题
        </button>
        <span>{{ Object.values(answers).filter(value => value.trim()).length }}/{{ questions.length }} 已填写</span>
        <button type="button" class="ask-user-submit" :disabled="!canSubmit" @click="submit()">
          {{ sending ? '提交中…' : '提交回答' }}
        </button>
      </footer>
    </template>
  </section>
</template>
