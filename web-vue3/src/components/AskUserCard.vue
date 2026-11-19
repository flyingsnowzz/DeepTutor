<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import { buildAskUserReply, type AskUserCardData, type AskUserQuestion } from '../askUser'
import { renderInlineMarkdown } from '../mathMarkdown'

const props = defineProps<{
  data: AskUserCardData
  disabled?: boolean
  retryToken?: number
}>()
const emit = defineEmits<{
  submit: [payload: { text: string; answers: Array<{ questionId: string; text: string }> }]
}>()

const active = ref(0)
const picks = ref<Record<string, string[]>>({})
const customSelected = ref<Record<string, boolean>>({})
const customText = ref<Record<string, string>>({})
const sending = ref(false)
const customInput = ref<HTMLTextAreaElement | null>(null)

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
const locked = computed(() => Boolean(props.disabled || sending.value || props.data.streaming || props.data.resolved))
const answeredCount = computed(() => Object.values(answers.value).filter(value => value.trim()).length)
function inlineHtml(value: string) {
  return renderInlineMarkdown(value)
}

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
  void nextTick(() => customInput.value?.focus())
}

function updateCustom(question: AskUserQuestion, value: string) {
  customText.value = { ...customText.value, [question.id]: value }
  customSelected.value = { ...customSelected.value, [question.id]: true }
}

function skip() {
  if (!activeQuestion.value || locked.value) return
  const questionId = activeQuestion.value.id
  const finalAnswers = { ...answers.value, [questionId]: '' }
  picks.value = { ...picks.value, [questionId]: [] }
  customSelected.value = { ...customSelected.value, [questionId]: false }
  customText.value = { ...customText.value, [questionId]: '' }
  const next = questions.value.findIndex((question, index) => index > active.value && !finalAnswers[question.id]?.trim())
  if (next >= 0) active.value = next
  else submit(finalAnswers)
}

function submit(finalAnswers: Record<string, string> = answers.value) {
  if (locked.value) return
  sending.value = true
  emit('submit', buildAskUserReply(props.data.payload, finalAnswers))
}

function onKeydown(event: KeyboardEvent) {
  if (locked.value || event.metaKey || event.ctrlKey || event.altKey || !activeQuestion.value) return
  const target = event.target as HTMLElement
  if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
  const index = Number(event.key) - 1
  if (!Number.isInteger(index) || index < 0 || index >= activeQuestion.value.options.length) return
  event.preventDefault()
  pick(activeQuestion.value, activeQuestion.value.options[index].label)
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
})
watch(() => props.disabled, disabled => { if (!disabled) sending.value = false })
watch(() => props.retryToken, () => { sending.value = false })
</script>

<template>
  <section class="ask-user-card" :data-resolved="data.resolved || undefined" @keydown="onKeydown">
    <div v-if="data.payload.intro" class="ask-user-intro" v-html="inlineHtml(data.payload.intro)" />
    <p v-if="data.streaming" class="ask-user-status" role="status">正在生成问题…</p>
    <p v-else-if="sending" class="ask-user-status" role="status">正在提交回答…</p>

    <div v-if="data.resolved" class="ask-user-resolved">
      <div v-for="question in questions" :key="question.id">
        <div class="ask-user-resolved-prompt" v-html="inlineHtml(question.prompt)" />
        <div class="ask-user-resolved-answer" v-html="inlineHtml(answeredText(question.id))" />
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
          :disabled="locked"
          @click="active = index"
        ><span class="ask-user-tab-badge">{{ answers[question.id]?.trim() ? '✓' : index + 1 }}</span>{{ question.header || `问题 ${index + 1}` }}</button>
      </div>

      <div v-if="activeQuestion" class="ask-user-question">
        <h3><span v-html="inlineHtml(activeQuestion.prompt)" /><small v-if="activeQuestion.multi_select">可多选</small></h3>
        <div class="ask-user-options">
          <button
            v-for="(option, optionIndex) in activeQuestion.options"
            :key="`${activeQuestion.id}:${option.label}`"
            type="button"
            :aria-pressed="!customSelected[activeQuestion.id] && (picks[activeQuestion.id] || []).includes(option.label)"
            :disabled="locked"
            @click="pick(activeQuestion, option.label)"
          >
            <span class="ask-user-option-badge">{{ activeQuestion.multi_select && (picks[activeQuestion.id] || []).includes(option.label) ? '✓' : optionIndex + 1 }}</span>
            <span class="ask-user-option-copy"><strong v-html="inlineHtml(option.label)" /><small v-if="option.description" v-html="inlineHtml(option.description)" /></span>
          </button>
        </div>
        <div v-if="activeQuestion.allow_free_text" class="ask-user-custom" :class="{ selected: customSelected[activeQuestion.id] }">
          <span class="ask-user-option-badge"><LegacyIcon name="edit" :size="15" /></span>
          <textarea
            v-if="customSelected[activeQuestion.id]"
            ref="customInput"
            rows="2"
            :placeholder="activeQuestion.placeholder || '输入你的回答…'"
            :value="customText[activeQuestion.id] || ''"
            :disabled="locked"
            @input="updateCustom(activeQuestion, ($event.target as HTMLTextAreaElement).value)"
          />
          <button v-else type="button" :disabled="locked" @click="chooseCustom(activeQuestion)">{{ customText[activeQuestion.id]?.trim() || '其他想法…' }}</button>
        </div>
      </div>
      <div v-else-if="data.streaming" class="ask-user-skeleton" aria-hidden="true"><span /><span /></div>

      <footer>
        <span v-if="questions.length > 1">{{ answeredCount }}/{{ questions.length }} 已回答；未回答的问题会跳过</span>
        <span v-else />
        <div>
          <button v-if="questions.length > 1 && active > 0" type="button" class="ask-user-previous" :disabled="locked" @click="active -= 1">上一题</button>
          <button v-if="activeQuestion" type="button" class="ask-user-skip" :disabled="locked" @click="skip">跳过</button>
          <button v-if="questions.length > 1 && active < questions.length - 1" type="button" class="ask-user-submit" :disabled="locked" @click="active += 1">下一题</button>
          <button v-else type="button" class="ask-user-submit" :disabled="locked || !questions.length" @click="submit()">{{ questions.length > 1 ? '提交回答' : '提交' }}</button>
        </div>
      </footer>
    </template>
  </section>
</template>
