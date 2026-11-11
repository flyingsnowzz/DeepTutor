<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { post } from '../api'
import LegacyIcon from './LegacyIcon.vue'

/**
 * Vue3 port of web/components/settings/ProviderModelDiscovery.tsx.
 * Probes POST /api/settings/test-provider with the in-form credentials and
 * lets the user pick returned model IDs (single or multi-select). A changed
 * credential set remounts/reruns cleanly; stale requests are aborted.
 */
type ProbeInput = {
  binding: string
  base_url: string
  api_key?: string | string[] | null
  api_format?: string
  api_version?: string
  extra_headers?: Record<string, string> | string
  proxy?: string
  service?: string
  profile_id?: string
  connection_id?: string
}
type ProbeResult = { status: string; models: { id: string }[] }

const props = defineProps<{
  input: ProbeInput
  selectedModels?: string[]
  /** Remount key handled by parent via :key, but watch input as a backstop. */
  pickMany?: boolean
}>()
const emit = defineEmits<{
  pick: [model: string]
  pickMany: [models: string[]]
}>()

const STATUS_MESSAGES: Record<string, string> = {
  connected: '连接成功，可在下方选择可用模型。',
  auth_error: '提供方拒绝了这些凭据，请检查 API Key 及其权限。',
  unavailable: '该端点无法列出模型。请手动输入模型 ID，再通过模型测试验证访问。',
  rate_limited: '提供方正在限流，请稍后再试。',
  timeout: '连接超时，请检查地址与网络后重试。',
  unreachable: '无法连接到提供方，请检查地址与网络。',
  invalid_url: '请输入有效的 HTTP 或 HTTPS 提供方地址。',
  http_error: '提供方返回了错误，请检查地址或稍后再试。',
}

const running = ref(false)
const result = ref<ProbeResult | null>(null)
const error = ref('')
const query = ref('')
const picked = ref<string[]>([])
let controller: AbortController | null = null

const selected = computed(() => props.selectedModels ?? [])
const canProbe = computed(() => props.input.base_url.trim().length > 0)
const models = computed(() =>
  (result.value?.models ?? [])
    .map(m => m.id)
    .filter(id => id.toLowerCase().includes(query.value.trim().toLowerCase())),
)
const statusText = computed(() => {
  if (!result.value) return ''
  if (result.value.status === 'connected') {
    if (!result.value.models.length) return '连接成功，但提供方未返回模型，你仍可手动输入模型 ID。'
    if (props.pickMany) return `连接成功，提供方返回了 ${result.value.models.length} 个模型。`
    return `连接成功，提供方返回了 ${result.value.models.length} 个模型。`
  }
  return STATUS_MESSAGES[result.value.status] || STATUS_MESSAGES.http_error
})
const newPicks = computed(() => picked.value.filter(id => !selected.value.includes(id)))

watch(
  () => JSON.stringify(props.input),
  () => {
    controller?.abort()
    result.value = null
    error.value = ''
    picked.value = []
    query.value = ''
  },
)

onBeforeUnmount(() => controller?.abort())

async function probe() {
  if (running.value || !canProbe.value) return
  controller?.abort()
  const request = new AbortController()
  controller = request
  running.value = true
  result.value = null
  error.value = ''
  try {
    const payload = await post<ProbeResult>('/api/settings/test-provider', {
      binding: props.input.binding || 'openai',
      base_url: props.input.base_url,
      api_key: props.input.api_key ?? null,
      api_format: props.input.api_format || 'auto',
      api_version: props.input.api_version || '',
      extra_headers: props.input.extra_headers ?? null,
      proxy: props.input.proxy || '',
      service: props.input.service || 'llm',
      profile_id: props.input.profile_id ?? null,
      connection_id: props.input.connection_id ?? null,
    })
    if (!request.signal.aborted) result.value = payload
  } catch (cause) {
    if (!request.signal.aborted) error.value = cause instanceof Error ? cause.message : '无法连接到提供方。'
  } finally {
    if (!request.signal.aborted) running.value = false
  }
}

function toggle(id: string, checked: boolean) {
  picked.value = checked ? [...picked.value, id] : picked.value.filter(item => item !== id)
}
function addSelected() {
  if (!newPicks.value.length) return
  emit('pickMany', newPicks.value)
  picked.value = []
}
function chooseSingle(id: string) {
  if (id) emit('pick', id)
}
</script>

<template>
  <div class="provider-discovery">
    <div class="provider-discovery-head">
      <button type="button" class="provider-discovery-btn" :disabled="running || !canProbe" @click="probe">
        <LegacyIcon :name="running ? 'activity' : 'settings'" :size="15" />
        {{ running ? '正在测试连接…' : '测试提供方连接' }}
      </button>
      <span class="provider-discovery-hint">无需先填模型，测试同时会拉取可用模型列表。</span>
    </div>
    <div role="status" aria-live="polite" class="provider-discovery-status">
      <p v-if="error" class="is-error">{{ error }}</p>
      <p v-else-if="result" :class="result.status === 'connected' ? 'is-ok' : 'is-warn'">
        <LegacyIcon v-if="result.status === 'connected'" name="check" :size="14" />
        {{ statusText }}
      </p>
    </div>
    <div v-if="result?.models.length" class="provider-discovery-picker">
      <input v-if="result.models.length > 10" v-model="query" type="search" class="provider-discovery-search"
             aria-label="搜索可用模型" placeholder="搜索可用模型">
      <div v-if="pickMany" class="provider-discovery-list" role="group" aria-label="从该提供方选择模型">
        <label v-for="id in models" :key="id" class="provider-discovery-option">
          <input type="checkbox" :disabled="selected.includes(id)"
                 :checked="selected.includes(id) || picked.includes(id)"
                 @change="toggle(id, ($event.target as HTMLInputElement).checked)">
          <span class="provider-discovery-id">{{ id }}</span>
          <span v-if="selected.includes(id)" class="provider-discovery-added">已添加</span>
        </label>
        <p v-if="!models.length" class="provider-discovery-empty">没有匹配的模型</p>
      </div>
      <select v-else class="provider-discovery-select" value="" aria-label="选择一个模型"
              @change="chooseSingle(($event.target as HTMLSelectElement).value)">
        <option value="">选择模型…</option>
        <option v-for="id in models" :key="id" :value="id">{{ id }}</option>
      </select>
      <button v-if="pickMany" type="button" class="provider-discovery-add" :disabled="!newPicks.length" @click="addSelected">
        添加所选模型
      </button>
      <p class="provider-discovery-foot">也可以手动输入模型 ID；列出模型不代表每个功能都可访问。</p>
    </div>
  </div>
</template>
