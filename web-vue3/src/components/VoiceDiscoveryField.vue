<script setup lang="ts">
/**
 * Live voice discovery field — Vue3 port of
 * web/components/settings/VoiceDiscoveryField.tsx.
 *
 * Fetches the account/provider voices for the TTS model being edited without
 * applying the draft, offers a dropdown when voices are returned, keeps an
 * unlisted current voice visible, and always allows manual ID entry. A
 * connection-fingerprint watcher re-runs the lookup only when the speech
 * connection/identity changes — editing the voice itself never refetches.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import { api } from '../api'
import {
  hasSpeechModel,
  isListedVoice,
  parseVoiceDiscovery,
  resolveDiscoveryPhase,
  voiceDiscoveryStatus,
  voiceLookupFingerprint,
  type CatalogShape,
  type VoiceDiscoveryResult,
} from '../voiceDiscovery'

const props = defineProps<{
  catalog: CatalogShape | null
  profileId: string
  modelId: string
  modelValue: string
  disabled?: boolean
}>()

const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()

const result = ref<VoiceDiscoveryResult | null>(null)
const loading = ref(false)
const failed = ref(false)
const attempt = ref(0)
const manual = ref(false)

const hasModel = computed(() => hasSpeechModel(props.catalog, props.profileId, props.modelId))
const fingerprint = computed(() =>
  voiceLookupFingerprint(props.catalog, props.profileId, props.modelId),
)
const listed = computed(() => isListedVoice(result.value, props.modelValue))
const phase = computed(() =>
  resolveDiscoveryPhase({
    hasModel: hasModel.value,
    loading: loading.value,
    failed: failed.value,
    result: result.value,
  }),
)
const statusText = computed(() => voiceDiscoveryStatus(phase.value))
const selectValue = computed(() => (listed.value ? props.modelValue : ''))

let debounceId: ReturnType<typeof setTimeout> | undefined
let timeoutId: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | null = null
let active = false

function clearTimers() {
  if (debounceId) clearTimeout(debounceId)
  if (timeoutId) clearTimeout(timeoutId)
  debounceId = undefined
  timeoutId = undefined
}

async function fetchVoices() {
  if (!hasModel.value || !props.catalog) {
    loading.value = false
    return
  }
  controller?.abort()
  const request = new AbortController()
  controller = request
  active = true
  loading.value = true
  failed.value = false
  result.value = null
  timeoutId = setTimeout(() => request.abort(), 30000)
  try {
    const payload = await api<unknown>('/api/settings/voice/voices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: request.signal,
      body: JSON.stringify({
        catalog: props.catalog,
        profile_id: props.profileId,
        model_id: props.modelId,
      }),
    })
    if (!active) return
    const parsed = parseVoiceDiscovery(payload)
    if (!parsed) {
      failed.value = true
    } else {
      result.value = parsed
    }
  } catch (error) {
    if (!active || (error instanceof DOMException && error.name === 'AbortError')) return
    failed.value = true
  } finally {
    if (active) {
      loading.value = false
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = undefined
    }
  }
}

function scheduleFetch() {
  if (!hasModel.value) {
    loading.value = false
    return
  }
  clearTimers()
  debounceId = setTimeout(() => void fetchVoices(), 250)
}

function refresh() {
  attempt.value += 1
}

function chooseVoice(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value) emit('update:modelValue', value)
}

function editManual(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

// Re-run when the connection fingerprint changes or the user asks to refresh.
watch(
  [fingerprint, () => attempt.value],
  () => {
    active = false
    controller?.abort()
    clearTimers()
    scheduleFetch()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  active = false
  controller?.abort()
  clearTimers()
})
</script>

<template>
  <section class="voice-discovery" aria-label="声音">
    <div class="voice-discovery-head">
      <h4>声音</h4>
      <button
        type="button"
        class="voice-discovery-refresh"
        :disabled="loading || !hasModel"
        @click="refresh"
      >
        <LegacyIcon :name="loading ? 'loader' : 'refreshCw'" :size="14" :class="{ 'is-spinning': loading }" />
        {{ loading ? '正在获取…' : '刷新' }}
      </button>
    </div>
    <p role="status" class="voice-discovery-status">{{ statusText }}</p>

    <label v-if="result && result.voices.length" class="voice-discovery-select">
      <span>选择音色</span>
      <select :value="selectValue" :disabled="disabled" @change="chooseVoice">
        <option value="">选择音色</option>
        <option v-for="voice in result.voices" :key="voice.id" :value="voice.id">
          {{ voice.label }}
        </option>
      </select>
    </label>

    <p v-if="modelValue && !listed" class="voice-discovery-current">
      当前音色（不在本次查询结果中）：{{ modelValue }}
    </p>

    <button
      type="button"
      class="voice-discovery-manual-toggle"
      :aria-expanded="manual"
      @click="manual = !manual"
    >
      手动填写音色 ID
    </button>
    <label v-if="manual" class="voice-discovery-manual">
      <span>Voice ID</span>
      <input
        type="text"
        :value="modelValue"
        :disabled="disabled"
        placeholder="提供方支持的音色 ID"
        @input="editManual"
      >
    </label>
  </section>
</template>
