<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import SubagentRunTranscript from './SubagentRunTranscript.vue'
import LegacyIcon from './LegacyIcon.vue'
import { streamSubagentMessage } from '../subagents'
import { subagentIdentity, type SubagentEvent } from '../subagentTrace'

const props = defineProps<{
  events: SubagentEvent[]
  sessionId?: string | null
}>()
const localEvents = ref<SubagentEvent[]>([])
const input = ref('')
const busy = ref(false)
const error = ref('')
let controller: AbortController | null = null
let sequence = 0
const identity = computed(() => subagentIdentity(props.events))
const name = computed(() => identity.value.name)
const allEvents = computed(() => [...props.events, ...localEvents.value])
const directChat = computed(() => Boolean(name.value && !['partner', 'partner_group'].includes(identity.value.kind)))

function append(channel: string, text: string, mergeId?: string) {
  localEvents.value.push({
    type: 'progress',
    source: 'subagent',
    timestamp: sequence++,
    content: text,
    metadata: {
      trace_kind: 'subagent_event',
      subagent_channel: channel,
      subagent_name: name.value,
      ...(mergeId ? { subagent_merge_id: `local:${mergeId}` } : {}),
    },
  })
}

async function send() {
  const message = input.value.trim()
  if (!message || busy.value || !directChat.value) return
  input.value = ''
  error.value = ''
  busy.value = true
  controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
      error.value = '智能体响应超时，请重试。'
      controller?.abort()
    }, 5 * 60_000)
  }
  arm()
  try {
    for await (const line of streamSubagentMessage(
      name.value,
      { chat_session_id: props.sessionId || '', message },
      controller.signal,
    )) {
      arm()
      if (line.done) break
      if (line.channel) append(line.channel, line.text || '', line.merge_id)
    }
  } catch (cause) {
    if ((cause as Error).name !== 'AbortError') error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (timeout) clearTimeout(timeout)
    controller = null
    busy.value = false
  }
}
function stop() {
  controller?.abort()
  controller = null
  busy.value = false
}
onBeforeUnmount(stop)
</script>

<template>
  <div class="subagent-tab">
    <div class="subagent-tab-thread"><SubagentRunTranscript :events="allEvents" /></div>
    <div v-if="directChat" class="subagent-direct-composer">
      <p v-if="error" role="alert">{{ error }}</p>
      <div>
        <textarea v-model="input" rows="2" :disabled="busy || !name" :placeholder="name ? `直接发消息给 ${name}…` : '直接发消息给智能体…'" @keydown.enter.exact.prevent="send" />
        <button type="button" :aria-label="busy ? '停止' : '发送'" @click="busy ? stop() : send()" :disabled="!busy && !input.trim()">
          <LegacyIcon :name="busy ? 'stop' : 'arrowUp'" :size="15" />
        </button>
      </div>
    </div>
  </div>
</template>
