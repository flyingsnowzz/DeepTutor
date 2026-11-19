<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ApiError, post } from '../api'
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
type ProbeResult = { status: string; models: { id: string }[]; capabilities?: { category: string; evidence?: string }[]; warning?: string; http_status?: number; checked_at?: string }

const props = defineProps<{
  input: ProbeInput
  selectedModels?: string[]
  /** Remount key handled by parent via :key, but watch input as a backstop. */
  pickMany?: boolean
  language?: string
  connectionMode?: boolean
  discovery?: ProbeResult | null
  hints?: string[]
}>()
const emit = defineEmits<{
  pick: [model: string]
  pickMany: [models: string[]]
  result: [value: ProbeResult & { checked_at: string }]
}>()

const chinese = computed(() => (props.language || 'zh').toLowerCase().startsWith('zh'))
const tr = (zh: string, en: string) => chinese.value ? zh : en
const statusMessages = computed<Record<string, string>>(() => ({
  connected: tr('连接成功，可在下方选择可用模型。', 'Connected. Available models are ready to choose below.'),
  auth_error: tr('提供方拒绝了这些凭据，请检查 API Key 及其权限。', 'The provider rejected these credentials. Check the API key and its permissions.'),
  unavailable: tr('该端点无法列出模型。请手动输入模型 ID，再通过模型测试验证访问。', 'This endpoint cannot list models. Enter a model ID manually, then test the model to verify access.'),
  rate_limited: tr('提供方正在限流，请稍后再试。', 'The provider is rate limiting requests. Try again later.'),
  timeout: tr('连接超时，请检查地址与网络后重试。', 'The connection timed out. Check the address and network, then try again.'),
  unreachable: tr('无法连接到提供方，请检查地址与网络。', 'Could not reach the provider. Check the address and network.'),
  invalid_url: tr('请输入有效的 HTTP 或 HTTPS 提供方地址。', 'Enter a valid HTTP or HTTPS provider address.'),
  http_error: tr('提供方返回了错误，请检查地址或稍后再试。', 'The provider returned an error. Check the address or try again later.'),
  json_forbidden: tr('SearXNG 拒绝 JSON 搜索请求，请在配置中启用 json 格式并检查访问规则。', 'SearXNG rejected the JSON search request. Enable the json format and check access rules.'),
  invalid_response: tr('搜索端点返回了无效响应，请检查 SearXNG JSON 搜索地址。', 'The search endpoint returned an invalid response. Check the SearXNG JSON search API address.'),
}))

const running = ref(false)
const result = ref<ProbeResult | null>(props.discovery || null)
const error = ref('')
const query = ref('')
const picked = ref<string[]>([])
let controller: AbortController | null = null
watch(() => props.discovery, value => { result.value = value || null })

const selected = computed(() => props.selectedModels ?? [])
const categories = [
  { key: 'llm', zh: '语言模型', en: 'Language models' },
  { key: 'embedding', zh: '嵌入模型', en: 'Embedding models' },
  { key: 'search', zh: '搜索', en: 'Search' },
  { key: 'voice', zh: '语音', en: 'Voice' },
  { key: 'generation', zh: '多模态生成', en: 'Multimodal generation' },
]
function categoryEvidence(key: string) {
  const evidence = result.value?.capabilities?.find(item => item.category === key)
  return evidence?.evidence === 'metadata' ? tr('已探测', 'Detected') : evidence || props.hints?.includes(key) ? tr('提供方支持', 'Provider supports') : tr('未知', 'Unknown')
}
const canProbe = computed(() => props.input.base_url.trim().length > 0)
const models = computed(() =>
  (result.value?.models ?? [])
    .map(m => m.id)
    .filter(id => id.toLowerCase().includes(query.value.trim().toLowerCase())),
)
const statusText = computed(() => {
  if (!result.value) return ''
  if (result.value.status === 'connected') {
    if (props.connectionMode) return props.input.service === 'search' ? tr('提供方连接成功。', 'Provider connected.') : tr(`提供方连接成功 · ${result.value.models.length} 个可用模型`, `Provider connected · ${result.value.models.length} models available`)
    if (!result.value.models.length) return tr('连接成功，但提供方未返回模型，你仍可手动输入模型 ID。', 'Connected, but the provider returned no models. You can enter a model ID manually.')
    return tr(`连接成功，提供方返回了 ${result.value.models.length} 个模型。`, `Connected. The provider returned ${result.value.models.length} models.`)
  }
  return statusMessages.value[result.value.status] || statusMessages.value.http_error
})
const newPicks = computed(() => picked.value.filter(id => !selected.value.includes(id)))

watch(
  () => JSON.stringify(props.input),
  () => {
    controller?.abort()
    controller = null
    running.value = false
    result.value = props.discovery || null
    error.value = ''
    picked.value = []
    query.value = ''
  },
)
watch(() => props.discovery, value => { if (!running.value) result.value = value || null })

onBeforeUnmount(() => { controller?.abort(); controller = null })

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
    }, { signal: request.signal })
    if (!request.signal.aborted) {
      result.value = payload
      emit('result', { ...payload, checked_at: new Date().toISOString() })
    }
  } catch (cause) {
    if (!request.signal.aborted) {
      if (props.connectionMode) {
        const failed = { status: cause instanceof ApiError && cause.status ? 'http_error' : 'unreachable', models: [], ...(cause instanceof ApiError && cause.status ? { http_status: cause.status } : {}) }
        result.value = failed
        emit('result', { ...failed, checked_at: new Date().toISOString() })
      } else error.value = cause instanceof Error ? cause.message : tr('无法连接到提供方。', 'Could not reach the provider.')
    }
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
        {{ running ? tr('正在测试连接…', 'Testing connection…') : tr('测试提供方连接', 'Test provider connection') }}
      </button>
      <span class="provider-discovery-hint">{{ connectionMode ? tr('检查连接并发现该提供方支持的服务。', 'Check access and discover the services this provider offers.') : tr('无需先填模型，测试同时会拉取可用模型列表。', 'No model needed. Testing also retrieves available models.') }}</span>
    </div>
    <div role="status" aria-live="polite" class="provider-discovery-status">
      <p v-if="error" class="is-error">{{ error }}</p>
      <p v-else-if="result" :class="result.status === 'connected' ? 'is-ok' : 'is-warn'">
        <LegacyIcon v-if="result.status === 'connected'" name="check" :size="14" />
        {{ statusText }}<template v-if="result.http_status != null"> · HTTP {{ result.http_status }}</template>
      </p>
      <p v-if="result?.warning === 'partial_models'">{{ tr('仅列出了部分模型；仍可手动输入其他模型 ID。', 'Only some models were listed. You can still enter other model IDs manually.') }}</p>
      <p v-if="result?.warning === 'empty_results'">{{ tr('搜索接口可访问，但没有返回结果。请检查启用的搜索引擎及网络。', 'The search API is reachable but returned no results. Check enabled engines and network access.') }}</p>
    </div>
    <template v-if="connectionMode">
      <div class="provider-discovery-capabilities"><div v-for="item in categories" :key="item.key"><strong>{{ chinese ? item.zh : item.en }}</strong><small>{{ categoryEvidence(item.key) }}</small></div></div>
      <p class="provider-discovery-foot">{{ tr('探测结果描述模型能力，不代表 API 兼容；请测试具体模型以验证账号访问权限。', 'Detected describes model modalities, not API compatibility. Test a specific model to verify account access.') }}</p>
    </template>
    <div v-if="!connectionMode && result?.models.length" class="provider-discovery-picker">
      <input v-if="result.models.length > 10" v-model="query" type="search" class="provider-discovery-search"
             :aria-label="tr('搜索可用模型', 'Search available models')" :placeholder="tr('搜索可用模型', 'Search available models')">
      <div v-if="pickMany" class="provider-discovery-list" role="group" :aria-label="tr('从该提供方选择模型', 'Choose a model from this provider')">
        <label v-for="id in models" :key="id" class="provider-discovery-option">
          <input type="checkbox" :disabled="selected.includes(id)"
                 :checked="selected.includes(id) || picked.includes(id)"
                 @change="toggle(id, ($event.target as HTMLInputElement).checked)">
          <span class="provider-discovery-id">{{ id }}</span>
          <span v-if="selected.includes(id)" class="provider-discovery-added">{{ tr('已添加', 'Added') }}</span>
        </label>
        <p v-if="!models.length" class="provider-discovery-empty">{{ tr('没有匹配的模型', 'No matching models') }}</p>
      </div>
      <select v-else class="provider-discovery-select" value="" :aria-label="tr('选择一个模型', 'Choose a model')"
              @change="chooseSingle(($event.target as HTMLSelectElement).value)">
        <option value="">{{ tr('选择模型…', 'Select a model...') }}</option>
        <option v-for="id in models" :key="id" :value="id">{{ id }}</option>
      </select>
      <button v-if="pickMany" type="button" class="provider-discovery-add" :disabled="!newPicks.length" @click="addSelected">
        {{ tr('添加所选模型', 'Add selected models') }}
      </button>
      <p class="provider-discovery-foot">{{ tr('也可以手动输入模型 ID；列出模型不代表每个功能都可访问。', 'You can also enter a model ID manually. Listing a model does not guarantee access to every feature.') }}</p>
    </div>
  </div>
</template>
