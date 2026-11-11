<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { scopedUrl } from '../workspaceScope'
import LegacyIcon from './LegacyIcon.vue'
interface Model { id: string; model?: string; name?: string; context_window?: string; context_window_source?: string; context_window_detected_at?: string; dimension?: string; supported_dimensions?: string }
interface Profile { id: string; name?: string; models: Model[] }
const props = defineProps<{ catalog: Record<string, any>; service: string; profile: Profile; model?: Model | null }>()
const emit = defineEmits<{ adopt: [value: { context_window?: string; context_window_source?: string; context_window_detected_at?: string; dimension?: string; supported_dimensions?: string }] }>()
const state = ref<'idle' | 'running' | 'success' | 'failed'>('idle')
const message = ref('')
const responseSnippet = ref('')
const logs = ref('')
const context = ref<{ value: number; source: string; detectedAt?: string } | null>(null)
const dimension = ref<number | null>(null)
const supportedDimensions = ref<number[]>([])
const fingerprint = ref('')
let source: EventSource | null = null
const usable = computed(() => props.service === 'search' || Boolean(props.model?.model?.trim()))
const currentFingerprint = computed(() => JSON.stringify([props.service, props.profile, props.model]))
const stale = computed(() => Boolean(fingerprint.value && fingerprint.value !== currentFingerprint.value))
function close() { source?.close(); source = null }
async function run() {
  if (!usable.value || state.value === 'running') return
  close()
  state.value = 'running'; message.value = '正在测试模型…'; logs.value = ''; responseSnippet.value = ''; context.value = null; dimension.value = null; supportedDimensions.value = []
  const catalog = JSON.parse(JSON.stringify(props.catalog))
  const target = catalog.services[props.service]
  if (props.service === 'task') target.mode = 'profiles'
  target.active_profile_id = props.profile.id
  if (props.service !== 'search') target.active_model_id = props.model?.id
  fingerprint.value = currentFingerprint.value
  try {
    const response = await fetch(scopedUrl(`/api/settings/tests/${props.service}/start`), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catalog }) })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload.run_id) throw new Error(typeof payload.detail === 'string' ? payload.detail : '无法启动连接测试')
    source = new EventSource(scopedUrl(`/api/settings/tests/${props.service}/${payload.run_id}/events`), { withCredentials: true })
    source.onmessage = event => {
      try {
        const entry = JSON.parse(event.data)
        logs.value += `[${entry.type}] ${entry.message || ''}\n`
        message.value = entry.message || message.value
        if (entry.type === 'response' && entry.snippet) responseSnippet.value = entry.snippet
        if (entry.type === 'context_window' && Number(entry.context_window) > 0) context.value = { value: Number(entry.context_window), source: entry.source || 'metadata', detectedAt: entry.detected_at }
        if (entry.type === 'capabilities') { dimension.value = Number(entry.detected_dim); supportedDimensions.value = entry.supported_dimensions || [] }
        if (entry.type === 'completed') finish('success', entry.message || '模型响应成功')
        if (entry.type === 'failed') finish('failed', entry.message || '模型测试失败')
      } catch { finish('failed', '无法读取模型测试结果') }
    }
    source.onerror = () => finish('failed', '测试连接中断')
  } catch (cause) { finish('failed', cause instanceof Error ? cause.message : '模型测试失败') }
}
function finish(next: 'success' | 'failed', text: string) { if (state.value !== 'running') return; state.value = next; message.value = text; close() }
function adopt() {
  if (state.value !== 'success') return
  emit('adopt', {
    ...(context.value ? { context_window: String(context.value.value), context_window_source: context.value.source, context_window_detected_at: context.value.detectedAt } : {}),
    ...(dimension.value ? { dimension: String(dimension.value), supported_dimensions: supportedDimensions.value.join(',') } : {}),
  })
}
onUnmounted(close)
</script>
<template><section class="model-test-panel" aria-label="模型连接测试"><div class="model-test-heading"><div><h3>{{ service === 'search' ? '测试搜索' : '测试此模型' }}</h3><p>{{ model?.model || profile.name }}</p></div><button :disabled="!usable || state === 'running'" @click="run"><LegacyIcon name="activity" :size="14" />{{ state === 'running' ? '正在测试…' : state === 'idle' ? '测试模型' : '再次测试' }}</button></div><p class="model-test-description">{{ service === 'llm' || service === 'task' ? '发送简短请求并检测上下文窗口，当前默认模型保持不变。' : service === 'embedding' ? '测试嵌入访问并检测维度，选择采用前不会修改现有维度。' : '使用当前设置发送示例请求，当前生效配置保持不变。' }}</p><div role="status" aria-live="polite"><p v-if="stale" class="model-test-stale">设置在上次测试后已更改，请重新测试。</p><div v-if="state !== 'idle'" class="model-test-result" :class="state"><p><LegacyIcon :name="state === 'success' ? 'check' : state === 'failed' ? 'close' : 'activity'" :size="15" />{{ state === 'success' ? '模型响应成功' : message }}</p><small v-if="responseSnippet">{{ responseSnippet }}</small><div v-if="context || dimension" class="model-detected"><div><strong>{{ context ? context.source === 'default' ? `上下文容量未知 · 保守预算 ${context.value} tokens` : `检测到上下文：${context.value} tokens` : `检测到维度：${dimension}` }}</strong><p v-if="context">来源：{{ context.source }}</p></div><button :disabled="state !== 'success' || context?.source === 'default'" @click="adopt">采用检测值</button></div></div></div><details v-if="logs"><summary>测试详情</summary><pre>{{ logs }}</pre></details></section></template>
