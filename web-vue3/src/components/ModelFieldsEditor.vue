<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '../api'

/**
 * Per-model field editor — Vue3 port of the field block inside
 * web/components/settings/ModelsWorkspace.tsx (RegistryField grid + context
 * window + reasoning effort) and ModelCapabilityFields.tsx (three-way
 * capability overrides resolved against POST /api/settings/model-capabilities).
 *
 * The parent owns the catalog object; every mutation is applied in place so
 * the existing draft/apply toolbar and dirty-signature logic keep working.
 */
type CapabilityKey = 'tools' | 'vision' | 'json_output' | 'reasoning'
type ServiceName = 'llm' | 'task' | 'embedding' | 'search' | 'tts' | 'stt' | 'imagegen' | 'videogen'
type CatalogModel = {
  id: string
  model?: string
  name?: string
  context_window?: string
  context_window_tokens?: number
  context_window_source?: string
  reasoning_effort?: string
  codex_supported_reasoning_levels?: string[]
  capabilities?: Partial<Record<CapabilityKey, boolean>>
  dimension?: string
  supported_dimensions?: string
  send_dimensions?: boolean | null
  voice?: string
  response_format?: string
  language?: string
  size?: string
  quality?: string
  style?: string
  aspect_ratio?: string
  duration?: string
  resolution?: string
  managed_by?: string
  [key: string]: unknown
}
type CatalogProfile = { id: string; read_only?: boolean; managed_by?: string; [key: string]: unknown }

const props = defineProps<{
  service: string
  profile: CatalogProfile
  model: CatalogModel | null
  binding?: string
}>()

const CAPABILITY_ROWS: { key: CapabilityKey; label: string }[] = [
  { key: 'tools', label: '工具调用（Tool calling）' },
  { key: 'vision', label: '图片输入（Vision）' },
  { key: 'json_output', label: 'JSON 输出' },
  { key: 'reasoning', label: '推理控制（Reasoning）' },
]

const FIELD_LABELS: Record<string, string> = {
  dimension: '维度（Dimensions）',
  supported_dimensions: '支持的维度',
  voice: '声音（Voice）',
  response_format: '响应格式',
  language: '语言',
  size: '图片尺寸',
  quality: '质量',
  style: '风格',
  aspect_ratio: '宽高比',
  duration: '时长（秒）',
  resolution: '分辨率',
}

/** Mirrors ModelsWorkspace: model.managed_by || profile.read_only || profile.managed_by. */
const managed = computed(() => Boolean(props.model?.managed_by || props.profile?.read_only || props.profile?.managed_by))
const isLanguageService = computed(() => props.service === 'llm' || props.service === 'task')
const contextWindowValue = computed(() => props.model?.context_window ?? (props.model?.context_window_tokens != null ? String(props.model.context_window_tokens) : ''))
const hasContextOverride = computed(() => Boolean(props.model?.context_window || props.model?.context_window_tokens != null))

const extraFields = computed<[keyof CatalogModel, string][]>(() => {
  switch (props.service) {
    case 'embedding':
      return [['dimension', FIELD_LABELS.dimension], ['supported_dimensions', FIELD_LABELS.supported_dimensions]]
    case 'tts':
      // Voice selection is owned by VoiceDiscoveryField (live lookup + manual ID).
      return [['response_format', FIELD_LABELS.response_format]]
    case 'stt':
      return [['language', FIELD_LABELS.language]]
    case 'imagegen':
      return [['size', FIELD_LABELS.size], ['quality', FIELD_LABELS.quality], ['style', FIELD_LABELS.style], ['response_format', FIELD_LABELS.response_format]]
    case 'videogen':
      return [['aspect_ratio', FIELD_LABELS.aspect_ratio], ['duration', FIELD_LABELS.duration], ['resolution', FIELD_LABELS.resolution]]
    default:
      return []
  }
})

const reasoningOptions = computed(() => {
  const levels = props.model?.codex_supported_reasoning_levels?.length
    ? props.model.codex_supported_reasoning_levels
    : ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  return [...new Set([...levels, ...(props.model?.reasoning_effort ? [props.model.reasoning_effort] : [])])]
})

function update(field: keyof CatalogModel, value: unknown) {
  if (!props.model) return
  const target = props.model
  // A signed-in provider still permits renaming, persisted separately as user_name.
  if (managed.value && field !== 'name') return
  if (field === 'context_window') {
    const raw = String(value)
    if (raw) {
      target.context_window = raw
      target.context_window_source = 'manual'
    } else {
      delete target.context_window
      target.context_window_source = 'default'
    }
    // Manual entry supersedes anything a connection test detected.
    delete target.context_window_tokens
    delete target.context_window_detected_at
    return
  }
  if (field === 'name' && managed.value) {
    target.user_name = String(value)
    return
  }
  if (field === 'name') target.name = String(value)
  ;(target as Record<string, unknown>)[field as string] = value
}

function resetContextWindow() {
  if (!props.model || managed.value) return
  delete props.model.context_window
  delete props.model.context_window_tokens
  props.model.context_window_source = 'default'
  delete props.model.context_window_detected_at
}

function capabilityValue(key: CapabilityKey): 'auto' | 'true' | 'false' {
  const value = props.model?.capabilities?.[key]
  return value === undefined ? 'auto' : String(value) as 'auto' | 'true' | 'false'
}

function setCapability(key: CapabilityKey, raw: string) {
  if (!props.model || managed.value) return
  const capabilities = { ...(props.model.capabilities || {}) }
  if (raw === 'auto') delete capabilities[key]
  else capabilities[key] = raw === 'true'
  if (Object.keys(capabilities).length) props.model.capabilities = capabilities
  else delete props.model.capabilities
}

function sendDimensionsValue(): 'auto' | 'true' | 'false' {
  const value = props.model?.send_dimensions
  return typeof value === 'boolean' ? String(value) as 'true' | 'false' : 'auto'
}

function setSendDimensions(raw: string) {
  if (!props.model || managed.value) return
  props.model.send_dimensions = raw === 'auto' ? null : raw === 'true'
}

/** Auto values reported by the backend capability tables (ModelCapabilityFields parity). */
const autoDefaults = ref<Partial<Record<CapabilityKey, boolean>> | null>(null)
const autoModelKey = ref('')
watch(
  () => ({ binding: props.binding, modelName: props.model?.model, modelId: props.model?.id, language: isLanguageService.value }),
  ({ binding, modelName }, _old, onCleanup) => {
    autoDefaults.value = null
    if (!modelName || !isLanguageService.value) return
    const modelNameText = String(modelName)
    const key = `${binding ?? ''}:${modelNameText}`
    autoModelKey.value = key
    const handle = window.setTimeout(async () => {
      try {
        const payload = await api<{ defaults?: Partial<Record<CapabilityKey, boolean>> }>('/api/settings/model-capabilities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ binding: (binding ?? '').trim() || 'openai', model: modelNameText.trim() }),
        })
        if (autoModelKey.value === key && payload.defaults) autoDefaults.value = payload.defaults
      } catch {
        // Leave the Auto labels without a resolved value; overrides still work.
      }
    }, 250)
    onCleanup(() => window.clearTimeout(handle))
  },
  { immediate: true },
)

function autoLabel(key: CapabilityKey): string {
  const value = autoDefaults.value?.[key]
  if (value === undefined) return '自动'
  return value ? '自动 · 支持' : '自动 · 不支持'
}
</script>

<template>
  <div v-if="model" class="model-fields-editor" :class="{ 'is-managed': managed }">
    <div class="model-fields-grid model-identity-grid">
      <label class="model-field">
        <span class="model-field-label">显示名称</span>
        <input type="text" :value="managed ? (model.user_name || model.name || '') : (model.name || '')" placeholder="模型显示名"
               aria-label="模型显示名称" @input="update('name', ($event.target as HTMLInputElement).value)">
      </label>
      <label class="model-field">
        <span class="model-field-label">模型 ID（提供方标识）</span>
        <input type="text" :value="model.model || ''" :disabled="managed" placeholder="例如 gpt-4o"
               aria-label="模型 ID" @input="update('model', ($event.target as HTMLInputElement).value)">
      </label>
    </div>
    <!-- LLM-shaped services: context window, reasoning effort, capability overrides -->
    <template v-if="isLanguageService">
      <div class="model-fields-grid">
        <label class="model-field">
          <span class="model-field-head">
            <span class="model-field-label">上下文长度（tokens）</span>
            <button type="button" class="model-field-link" :disabled="managed || !hasContextOverride" @click="resetContextWindow">使用默认值</button>
          </span>
          <input type="number" min="1" :value="contextWindowValue" :disabled="managed" placeholder="默认"
                 aria-label="上下文长度（tokens）" @input="update('context_window', ($event.target as HTMLInputElement).value)">
          <small class="model-field-hint">保留默认、输入自定义值，或在连接测试后采用检测值；测试不会覆盖你的选择。</small>
        </label>
        <label class="model-field">
          <span class="model-field-label">推理强度（Reasoning effort）</span>
          <select :value="model.reasoning_effort || ''" :disabled="managed" aria-label="推理强度"
                  @change="update('reasoning_effort', ($event.target as HTMLSelectElement).value)">
            <option value="">默认</option>
            <option v-for="level in reasoningOptions" :key="level" :value="level">{{ level }}</option>
          </select>
        </label>
      </div>
      <details class="model-capabilities" :open="false">
        <summary>模型能力</summary>
        <div class="model-capabilities-grid">
          <label v-for="row in CAPABILITY_ROWS" :key="row.key" class="model-field">
            <span class="model-field-label">{{ row.label }}<small class="model-auto-hint">{{ autoLabel(row.key) }}</small></span>
            <select :value="capabilityValue(row.key)" :disabled="managed" :aria-label="row.label"
                    @change="setCapability(row.key, ($event.target as HTMLSelectElement).value)">
              <option value="auto">{{ autoLabel(row.key) }}</option>
              <option value="true">支持</option>
              <option value="false">不支持</option>
            </select>
          </label>
        </div>
      </details>
    </template>

    <!-- Service-specific scalar fields -->
    <div v-if="extraFields.length" class="model-fields-grid">
      <label v-for="[field, label] in extraFields" :key="String(field)" class="model-field">
        <span class="model-field-label">{{ label }}</span>
        <input type="text" :value="String(model[field as string] ?? '')" :disabled="managed" placeholder="默认"
               :aria-label="label" @input="update(field, ($event.target as HTMLInputElement).value)">
      </label>
    </div>

    <!-- Embedding-only: whether to send dimensions on requests -->
    <label v-if="service === 'embedding'" class="model-field model-field-block">
      <span class="model-field-label">在嵌入请求中发送维度参数</span>
      <select :value="sendDimensionsValue()" :disabled="managed" aria-label="在嵌入请求中发送维度参数"
              @change="setSendDimensions(($event.target as HTMLSelectElement).value)">
        <option value="auto">自动</option>
        <option value="true">启用</option>
        <option value="false">停用</option>
      </select>
    </label>

    <p v-if="managed" class="model-managed-note">
      该登录提供方托管模型 ID、上下文与能力。你仍可以重命名模型并选择推理强度。
    </p>
  </div>
</template>
