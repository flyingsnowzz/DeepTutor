<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, nextTick } from 'vue'
import MarkdownView from './MarkdownView.vue'
import TurnActivityStream from './TurnActivityStream.vue'
import LegacyIcon from './LegacyIcon.vue'
import { api } from '../api'
import { scopedUrl } from '../workspaceScope'
import type { AnswerState } from '../quiz/answerState'
import type { QuizQuestion } from '../quiz/quizModel'
import {
  applyQuizFollowupEvent,
  buildQuizFollowupStartCommand,
  emptyQuizFollowupState,
  quizFollowupContext,
  type QuizFollowupEvent,
  type QuizFollowupState,
} from '../quiz/quizFollowup'

const props = defineProps<{
  question: QuizQuestion
  answer: AnswerState
  parentSessionId?: string | null
  turnId?: string | null
  language?: string | null
}>()

const state = ref<QuizFollowupState>(emptyQuizFollowupState())
const input = ref('')
const threadRoot = ref<HTMLElement | null>(null)
const socket = ref<WebSocket | null>(null)
let linkAttempts = 0

const context = computed(() => quizFollowupContext(props.question, props.answer))
const canSend = computed(() => input.value.trim().length > 0 && !state.value.busy)

async function hydratePersistedThread() {
  if (!props.parentSessionId || !props.turnId) return
  try {
    const entry = await api<{ followup_session_id?: string } | null>(
      `/api/question-notebook/entries/lookup/by-question?session_id=${encodeURIComponent(props.parentSessionId)}` +
        `&question_id=${encodeURIComponent(props.question.question_id)}` +
        `&turn_id=${encodeURIComponent(props.turnId)}&missing_ok=true`,
    )
    const followupId = entry?.followup_session_id
    if (!followupId || state.value.messages.length) return
    const detail = await api<{ messages?: Array<{ role?: string; content?: string; events?: QuizFollowupEvent[] }> }>(
      `/api/sessions/${encodeURIComponent(followupId)}`,
    )
    state.value = {
      ...state.value,
      sessionId: followupId,
      messages: (detail.messages ?? [])
        .filter(message => message.role === 'user' || message.role === 'assistant')
        .map(message => ({
          role: message.role as 'user' | 'assistant',
          content: message.content || '',
          events: message.events,
        })),
    }
  } catch {
    /* A new question has no follow-up notebook entry yet. */
  }
}

async function linkFollowupSession() {
  if (!props.parentSessionId || !props.turnId || !state.value.sessionId || linkAttempts >= 3) return
  linkAttempts += 1
  try {
    const entry = await api<{ id?: number } | null>(
      `/api/question-notebook/entries/lookup/by-question?session_id=${encodeURIComponent(props.parentSessionId)}` +
        `&question_id=${encodeURIComponent(props.question.question_id)}` +
        `&turn_id=${encodeURIComponent(props.turnId)}&missing_ok=true`,
    )
    if (!entry?.id) throw new Error('notebook entry not ready')
    await api(`/api/question-notebook/entries/${entry.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ followup_session_id: state.value.sessionId }),
    })
  } catch {
    window.setTimeout(linkFollowupSession, 800)
  }
}

function handleSocketMessage(event: MessageEvent) {
  let value: QuizFollowupEvent
  try {
    value = JSON.parse(event.data)
  } catch {
    return
  }
  const previousSessionId = state.value.sessionId
  state.value = applyQuizFollowupEvent(state.value, value)
  if (!previousSessionId && state.value.sessionId) void linkFollowupSession()
  if (value.type === 'done' || value.type === 'error' || value.type === 'protocol_error') socket.value?.close()
}

function send() {
  const content = input.value.trim()
  if (!canSend.value || !content) return
  const command = buildQuizFollowupStartCommand({
    question: props.question,
    answer: props.answer,
    userAnswer: context.value.userAnswer,
    isCorrect: context.value.isCorrect,
    parentSessionId: props.parentSessionId,
    sessionId: state.value.sessionId,
    turnId: props.turnId,
    content,
    language: props.language,
  })
  state.value = {
    ...state.value,
    messages: [...state.value.messages, { role: 'user', content }],
    busy: true,
    error: '',
  }
  input.value = ''
  const ws = new WebSocket(scopedUrl('/ws'))
  socket.value = ws
  ws.onopen = () => ws.send(JSON.stringify(command))
  ws.onmessage = handleSocketMessage
  ws.onerror = () => {
    state.value = { ...state.value, error: '追问连接失败', busy: false }
  }
  ws.onclose = () => {
    if (state.value.busy) state.value = { ...state.value, busy: false }
  }
}

function cancel() {
  if (!state.value.activeTurnId || !socket.value) return
  socket.value.send(JSON.stringify({ type: 'cancel_turn', turn_id: state.value.activeTurnId }))
  socket.value.close()
}

async function scrollToEnd() {
  await nextTick()
  const root = threadRoot.value
  if (root) root.scrollTop = root.scrollHeight
}

onMounted(() => {
  void hydratePersistedThread()
  void scrollToEnd()
})
onBeforeUnmount(() => socket.value?.close())
</script>

<template>
  <section class="quiz-followup-panel">
    <header>
      <LegacyIcon name="chat" :size="14" />
      <strong>继续追问</strong>
      <span>{{ state.messages.length }} 条消息</span>
    </header>

    <div ref="threadRoot" class="quiz-followup-thread">
      <div class="quiz-followup-pinned">
        <strong>题目</strong>
        <MarkdownView :content="question.question" />
        <p><b>你的答案：</b>{{ context.userAnswer || '（图片/自评）' }}</p>
        <p v-if="typeof context.isCorrect === 'boolean'">
          <b>判定：</b>{{ context.isCorrect ? '正确' : '错误' }}
        </p>
      </div>

      <p v-if="state.messages.length === 0" class="quiz-followup-empty">
        可以询问为什么这样判分、请它换个角度解释，或出一道相似题。
      </p>
      <template v-for="(message, index) in state.messages" :key="index">
        <div v-if="message.role === 'user'" class="quiz-followup-user">{{ message.content }}</div>
        <div v-else class="quiz-followup-assistant">
          <TurnActivityStream v-if="message.events?.length" :events="message.events.map(event => ({ ...event, type: event.type || 'event' }))" />
          <MarkdownView :content="message.content" />
        </div>
      </template>
      <TurnActivityStream v-if="state.streamEvents.length" :events="state.streamEvents.map(event => ({ ...event, type: event.type || 'event' }))" />
      <div v-if="state.streaming" class="quiz-followup-assistant">
        <MarkdownView :content="state.streaming" />
      </div>
      <p v-if="state.error" class="quiz-followup-error">{{ state.error }}</p>
    </div>

    <div class="quiz-followup-composer">
      <textarea
        v-model="input"
        rows="2"
        placeholder="针对这道题继续提问…"
        :disabled="state.busy"
        @keydown.enter.exact.prevent="send"
      />
      <button v-if="state.busy" type="button" class="is-stop" @click="cancel">停止</button>
      <button v-else type="button" :disabled="!canSend" @click="send">发送</button>
    </div>
  </section>
</template>
