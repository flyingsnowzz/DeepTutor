<script setup lang="ts">
import { computed, ref } from 'vue'
import { api } from '../api'
import LegacyIcon from './LegacyIcon.vue'
import {
  getCallProvider,
  getToolProvider,
  getTraceCallKind,
  getTraceMeta,
  groupTraceEvents,
  isTracePending,
  selectTraceDisplayItems,
  type TraceEvent,
  type TraceItem,
} from '../traceSelectors'

const props = defineProps<{
  sessionId: string
  messageId: number | string
  open: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const events = ref<TraceEvent[]>([])
const loading = ref(false)
const error = ref('')

const groups = computed(() => groupTraceEvents(events.value))
const displayItems = computed(() => selectTraceDisplayItems(groups.value))

function groupTitle(item: TraceItem): string {
  const kind = getTraceCallKind(item.events)
  const provider = getCallProvider(item.events)
  const tool = getToolProvider(item.events)
  const label = kind || tool?.source || '调用'
  return provider ? `${label} · ${provider}` : tool?.id ? `${label} · ${tool.id}` : label
}

function meta(event: TraceEvent) {
  return getTraceMeta(event)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const trace = await api<{ events?: TraceEvent[] } | TraceEvent[]>(
      `/api/sessions/${encodeURIComponent(props.sessionId)}/messages/${encodeURIComponent(String(props.messageId))}/events?limit=1000`,
    )
    events.value = Array.isArray(trace) ? trace : trace.events || []
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法加载调用追踪。'
  } finally {
    loading.value = false
  }
}

function reopen() {
  void load()
}

defineExpose({ reopen })
</script>

<template>
  <div v-if="open" class="trace-viewer" role="dialog" aria-modal="true" aria-label="调用追踪">
    <header class="trace-viewer-head">
      <h3>调用追踪</h3>
      <button type="button" aria-label="关闭" @click="emit('close')">
        <LegacyIcon name="close" :size="17" />
      </button>
    </header>

    <div class="trace-viewer-body">
      <div v-if="loading" class="trace-loading">加载中…</div>
      <p v-else-if="error" class="error" role="alert">{{ error }}</p>
      <p v-else-if="!displayItems.length" class="trace-empty">该消息暂无可展示的调用追踪。</p>

      <ol v-else class="trace-items">
        <template v-for="(item, index) in displayItems" :key="index">
          <li v-if="item.kind === 'trace'" class="trace-item">
            <article class="trace-card" :class="{ pending: isTracePending(item.trace.events) }">
              <header>
                <span class="trace-title">{{ groupTitle(item.trace) }}</span>
                <small v-if="isTracePending(item.trace.events)" class="trace-badge">进行中</small>
              </header>
              <ul class="trace-events">
                <li v-for="(event, eventIndex) in item.trace.events" :key="eventIndex" class="trace-event">
                  <code class="trace-event-type">{{ event.type }}</code>
                  <span v-if="meta(event).phase" class="trace-phase">{{ meta(event).phase }}</span>
                  <span v-if="event.content" class="trace-content">{{ event.content }}</span>
                </li>
              </ul>
            </article>
          </li>
          <li v-else class="trace-item trace-step">
            <header class="trace-step-head">
              <LegacyIcon name="layers" :size="14" />
              <span>步骤 {{ item.stepId }}</span>
              <small>{{ item.traces.length }} 次调用</small>
            </header>
            <ol class="trace-step-traces">
              <li v-for="(trace, traceIndex) in item.traces" :key="traceIndex">
                <article class="trace-card" :class="{ pending: isTracePending(trace.events) }">
                  <header>
                    <span class="trace-title">{{ groupTitle(trace) }}</span>
                    <small v-if="isTracePending(trace.events)" class="trace-badge">进行中</small>
                  </header>
                  <ul class="trace-events">
                    <li v-for="(event, eventIndex) in trace.events" :key="eventIndex" class="trace-event">
                      <code class="trace-event-type">{{ event.type }}</code>
                      <span v-if="meta(event).phase" class="trace-phase">{{ meta(event).phase }}</span>
                      <span v-if="event.content" class="trace-content">{{ event.content }}</span>
                    </li>
                  </ul>
                </article>
              </li>
            </ol>
          </li>
        </template>
      </ol>
    </div>
  </div>
</template>
