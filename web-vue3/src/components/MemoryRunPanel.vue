<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import LegacyIcon from './LegacyIcon.vue'

type Mode = 'update' | 'audit' | 'dedup'
type Selection = { profile_id: string; model_id: string }
type ModelOption = Selection & { profile_name: string; model_name: string; model: string; provider: string; provider_label?: string }
type RunEvent = { seq: number; ts: string; payload: Record<string, unknown> }
type RunHandle = { id?: string; run_id?: string; status?: string; error?: string }
type MemorySettings = { update: { l2_budget: number; l3_budget: number }; audit: { l2_budget: number; l3_budget: number }; dedup: { iterations: number } }
type RunOptions = { mode: Mode; budget: number; iterations: number; selection: Selection | null }

const props = defineProps<{ layer: 'L2' | 'L3'; docKey: string; busy: boolean; activeRun: RunHandle | null; events: RunEvent[] }>()
const emit = defineEmits<{ run: [options: RunOptions]; cancel: []; reset: []; clear: [] }>()
const mode = ref<Mode>('update')
const budget = ref(20)
const iterations = ref(3)
const settings = ref<MemorySettings | null>(null)
const options = ref<ModelOption[]>([])
const activeDefault = ref<Selection | null>(null)
const selectedKey = ref('')
const loadingModels = ref(true)
const modelError = ref(false)
const modes: { key: Mode; label: string; icon: string }[] = [
  { key: 'update', label: '更新记忆', icon: 'sparkles' },
  { key: 'audit', label: '检查记忆', icon: 'search' },
  { key: 'dedup', label: '去重', icon: 'kanban' },
]
const running = computed(() => props.busy || ['pending', 'running', 'queued'].includes(props.activeRun?.status || ''))
const selectedModel = computed(() => options.value.find(item => `${item.profile_id}:${item.model_id}` === selectedKey.value) || null)
const emptyTrace = computed(() => !props.events.length && !props.activeRun)
watch([mode, () => props.layer, settings], () => {
  if (!settings.value) return
  budget.value = mode.value === 'update'
    ? props.layer === 'L2' ? settings.value.update?.l2_budget ?? 20 : settings.value.update?.l3_budget ?? 20
    : props.layer === 'L2' ? settings.value.audit?.l2_budget ?? 20 : settings.value.audit?.l3_budget ?? 20
  iterations.value = settings.value.dedup?.iterations ?? 3
})
onMounted(async () => {
  try {
    const result = await api<{ active: Selection | null; options: ModelOption[] }>('/api/settings/llm-options')
    options.value = result.options || []
    activeDefault.value = result.active
    selectedKey.value = result.active ? `${result.active.profile_id}:${result.active.model_id}` : ''
  } catch { modelError.value = true }
  finally { loadingModels.value = false }
  try { settings.value = await api<MemorySettings>('/api/memory/settings') } catch { /* Defaults remain usable. */ }
})
function run() {
  if (running.value) return
  emit('run', { mode: mode.value, budget: budget.value, iterations: iterations.value, selection: selectedModel.value || activeDefault.value || null })
}
function reset() {
  if (running.value) return
  if (window.confirm('重置会删除当前记忆文件及其 seen-id 状态。下次更新将从零重新摄入全部 L1 实体。是否继续？')) emit('reset')
}
function stageName(stage: string) {
  return ({ run_started: '开始运行', trace_loaded: '已加载轨迹', chunked: '已分块', progress: '处理进度', facts_extracted: '已提取事实', op_applied: '已应用编辑', op_rejected: '已拒绝编辑', doc_updated: '文档已更新', undo_applied: '已撤销', done: '完成', run_ended: '运行结束', cancelled: '已取消', error: '错误', refs_dropped: '引用已丢弃' } as Record<string, string>)[stage] || stage
}
function payloadText(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}
</script>

<template>
  <aside class="memory-run-panel" aria-label="LLM 工作区">
    <header class="memory-run-header"><strong><LegacyIcon name="agents" :size="14" />LLM 工作区</strong><div><button v-if="events.length" type="button" :disabled="running" aria-label="清空轨迹" title="清空轨迹" @click="emit('clear')"><LegacyIcon name="x" :size="12" /></button><button type="button" class="memory-run-reset" :disabled="running" aria-label="重置记忆（删除 md + seen-id 状态）" title="重置记忆（删除 md + seen-id 状态）" @click="reset"><LegacyIcon name="rotateCcw" :size="12" /><span>重置</span></button></div></header>
    <div class="memory-run-composer">
      <div class="memory-run-modes"><button v-for="item in modes" :key="item.key" type="button" :disabled="running" :class="{ active: mode === item.key }" :aria-pressed="mode === item.key" @click="mode = item.key"><LegacyIcon :name="item.icon" :size="12" />{{ item.label }}</button></div>
      <div class="memory-run-controls">
        <label v-if="mode === 'dedup'">轮次<input v-model.number="iterations" type="number" min="1" max="20" :disabled="running" aria-label="轮次"></label>
        <label v-else>预算<input v-model.number="budget" type="number" min="1" max="200" :disabled="running" aria-label="预算"></label>
        <select v-model="selectedKey" :disabled="running || loadingModels || !options.length" aria-label="默认模型" :title="modelError ? '模型加载失败' : '默认模型'"><option value="">默认模型</option><option v-for="item in options" :key="`${item.profile_id}:${item.model_id}`" :value="`${item.profile_id}:${item.model_id}`">{{ item.profile_name }} · {{ item.model_name || item.model }}</option></select>
        <button v-if="running" type="button" class="memory-run-stop" aria-label="取消" title="取消" @click="emit('cancel')"><LegacyIcon name="stop" :size="12" /></button>
        <button v-else type="button" class="memory-run-start" aria-label="运行" title="运行" @click="run"><LegacyIcon name="send" :size="14" /></button>
      </div>
    </div>
    <div class="memory-run-trace">
      <div v-if="emptyTrace" class="memory-run-empty"><LegacyIcon name="agents" :size="22" /><p>选择一个模式并点击「运行」。LLM 轨迹（system prompt、user prompt、response）将按轮次显示在此处。</p></div>
      <ol v-else>
        <li v-for="event in events" :key="event.seq" class="memory-run-event"><strong>{{ stageName(String(event.payload.stage || '')) }}</strong><small v-if="payloadText(event.payload, 'message')">{{ payloadText(event.payload, 'message') }}</small><details v-if="payloadText(event.payload, 'system_prompt') || payloadText(event.payload, 'user_prompt') || payloadText(event.payload, 'response')"><summary>查看 LLM 轨迹</summary><pre v-if="payloadText(event.payload, 'system_prompt')">system prompt\n{{ payloadText(event.payload, 'system_prompt') }}</pre><pre v-if="payloadText(event.payload, 'user_prompt')">user prompt\n{{ payloadText(event.payload, 'user_prompt') }}</pre><pre v-if="payloadText(event.payload, 'response')">response\n{{ payloadText(event.payload, 'response') }}</pre></details><pre v-else-if="Object.keys(event.payload).length > 1" class="memory-run-payload">{{ event.payload }}</pre></li>
        <li v-if="running" class="memory-run-working">◌ 正在运行…</li>
        <li v-if="activeRun?.error" class="memory-run-error">{{ activeRun.error }}</li>
      </ol>
    </div>
  </aside>
</template>
