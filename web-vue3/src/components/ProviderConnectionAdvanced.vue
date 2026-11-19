<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ connection: Record<string, any>; language?: string; formats?: string[]; defaultFormat?: string }>()
const emit = defineEmits<{ update: [field: string, value: unknown] }>()
const chinese = computed(() => (props.language || 'zh').toLowerCase().startsWith('zh'))
const tr = (zh: string, en: string) => chinese.value ? zh : en
const protocol = computed({ get: () => String(props.connection.api_format || props.defaultFormat || 'auto'), set: value => emit('update', 'api_format', value) })
const showProtocol = computed(() => props.formats?.length !== 0 && props.connection.source_service !== 'search')
const allows = (format: string) => !props.formats || props.formats.includes(format)
const extraHeaders = computed({
  get: () => typeof props.connection.extra_headers === 'string' ? props.connection.extra_headers : props.connection.extra_headers ? JSON.stringify(props.connection.extra_headers) : '',
  set: value => emit('update', 'extra_headers', value),
})
const isSearch = computed(() => props.connection.source_service === 'search' || props.connection.provider === 'tavily' || props.connection.provider === 'brave')
</script>

<template>
  <div v-if="showProtocol" class="provider-protocol-field">
    <label>{{ tr('语言模型接口协议', 'Language-model API protocol') }}
      <select v-model="protocol" :aria-label="tr('接口协议', 'API protocol')">
        <option v-if="allows('auto')" value="auto">{{ tr('自动', 'Auto') }}</option>
        <option v-if="allows('openai_chat')" value="openai_chat">OpenAI Chat Completions</option>
        <option v-if="allows('openai_responses')" value="openai_responses">OpenAI Responses</option>
        <option v-if="allows('anthropic')" value="anthropic">Anthropic Messages</option>
      </select>
    </label>
  </div>
  <details class="provider-advanced-settings">
    <summary>{{ tr('高级连接设置', 'Advanced connection settings') }}</summary>
    <div class="model-form-grid">
      <label v-if="!isSearch">{{ tr('API 版本', 'API version') }}
        <input :value="connection.api_version || ''" :aria-label="tr('API 版本', 'API version')" @input="emit('update', 'api_version', ($event.target as HTMLInputElement).value)">
      </label>
      <label>{{ tr('额外请求头（JSON）', 'Extra headers (JSON)') }}
        <input v-model="extraHeaders" :aria-label="tr('额外请求头（JSON）', 'Extra headers (JSON)')" placeholder='{"X-Header":"value"}'>
      </label>
      <label v-if="isSearch">{{ tr('代理', 'Proxy') }}
        <input :value="connection.proxy || ''" :aria-label="tr('代理', 'Proxy')" placeholder="https://proxy.example.com" @input="emit('update', 'proxy', ($event.target as HTMLInputElement).value)">
      </label>
    </div>
  </details>
</template>

<style scoped>
.provider-protocol-field { margin-top: 14px; }
.provider-protocol-field label { display: grid; gap: 6px; font-size: 13px; }
.provider-protocol-field select { min-height: 36px; border: 1px solid var(--border); border-radius: 6px; background: var(--background); color: var(--foreground); padding: 6px 10px; }
.provider-advanced-settings { margin-top: 14px; border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.provider-advanced-settings summary { cursor: pointer; font-size: 13px; font-weight: 600; }
.provider-advanced-settings .model-form-grid { margin-top: 12px; }
</style>
