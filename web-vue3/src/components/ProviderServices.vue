<script setup lang="ts">
import { computed } from 'vue'
import { formatProviderLabel } from '../providerBranding'
import { providerAdapter, providerServiceSupport, type ProviderServiceName } from '../providerSupport'

type Option = { value: string; label?: string; status?: string }
const props = defineProps<{
  connection: Record<string, any>
  providers?: Record<string, Option[]>
  connectionTargets?: Array<{ provider: string; services?: Record<string, unknown> }>
  language?: string
}>()
const chinese = computed(() => (props.language || 'zh').toLowerCase().startsWith('zh'))
const tr = (zh: string, en: string) => chinese.value ? zh : en
const services: { key: ProviderServiceName; zh: string; en: string }[] = [
  { key: 'llm', zh: '语言模型', en: 'Language models' },
  { key: 'embedding', zh: '嵌入模型', en: 'Embedding models' },
  { key: 'tts', zh: '语音合成', en: 'Text-to-Speech' },
  { key: 'stt', zh: '语音识别', en: 'Speech-to-Text' },
  { key: 'imagegen', zh: '文生图', en: 'Image Generation' },
  { key: 'videogen', zh: '文生视频', en: 'Video Generation' },
  { key: 'search', zh: '搜索', en: 'Search' },
]
const overrides = computed<Record<string, { enabled?: boolean; binding?: string; base_url?: string }>>(() => props.connection.service_overrides || {})
function options(service: ProviderServiceName) {
  return (props.providers?.[service] || []).filter(option => option.value !== 'none' && option.status !== 'deprecated')
}
function support(service: ProviderServiceName) {
  return providerServiceSupport(props.connection, service, props.connectionTargets || [], props.providers || {})
}
function evidence(service: ProviderServiceName) {
  const key = support(service).evidence
  return {
    manual: tr('手动设置', 'Set by you'),
    detected: tr('从模型信息中检测到', 'Detected from model metadata'),
    builtin: tr('已有内置适配器', 'Built-in integration'),
    unknown: tr('尚未检测到 · 支持时可手动添加', 'Not detected · add manually if supported'),
  }[key]
}
function binding(service: ProviderServiceName) {
  return providerAdapter(props.connection, service, props.connectionTargets || [], props.providers || {}).binding
}
function patch(service: ProviderServiceName, changes: Record<string, unknown>) {
  props.connection.service_overrides = { ...overrides.value, [service]: { ...overrides.value[service], ...changes } }
}
function optionLabel(option: Option) {
  return formatProviderLabel(option.value, option.label || option.value, props.language || 'zh')
}
</script>

<template>
  <section class="provider-services" :aria-label="tr('可用服务类型', 'Available service types')">
    <div class="provider-services-head"><h3>{{ tr('可用服务类型', 'Available service types') }}</h3><button v-if="Object.keys(overrides).length" type="button" @click="connection.service_overrides = {}">{{ tr('恢复自动与内置类型', 'Use detected and built-in types') }}</button></div>
    <p>{{ tr('系统根据内置适配器和实时模型信息提示服务类型。你可以补充或隐藏类型，选择对应接口后测试模型确认可用性；已有模型会保留。', 'Built-in integrations and live model metadata suggest service types. You can add or hide types here. Choose the matching adapter and test a model to verify access; existing models are kept.') }}</p>
    <div class="provider-services-grid">
      <div v-for="item in services" :key="item.key" class="provider-service-card" :class="{ enabled: support(item.key).enabled }">
        <label class="provider-service-toggle"><input type="checkbox" :checked="support(item.key).enabled" :aria-label="chinese ? item.zh : item.en" @change="patch(item.key, { enabled: ($event.target as HTMLInputElement).checked, ...(($event.target as HTMLInputElement).checked ? { binding: binding(item.key) } : {}) })"><span><strong>{{ chinese ? item.zh : item.en }}</strong><small>{{ evidence(item.key) }}</small></span></label>
        <details v-if="support(item.key).enabled && item.key !== 'llm'"><summary>{{ tr('此服务的接入设置', 'Service connection options') }}</summary><label>{{ tr('服务接口／适配器', 'Service API / adapter') }}<select :value="binding(item.key)" :aria-label="`${chinese ? item.zh : item.en} ${tr('服务接口／适配器', 'service adapter')}`" @change="patch(item.key, { enabled: true, binding: ($event.target as HTMLSelectElement).value })"><option v-if="!options(item.key).some(option => option.value === binding(item.key))" :value="binding(item.key)">{{ binding(item.key) || tr('选择提供方', 'Choose a provider') }}</option><option v-for="option in options(item.key)" :key="option.value" :value="option.value">{{ optionLabel(option) }}</option></select></label><label>{{ tr('服务地址（可选）', 'Service URL (optional)') }}<input :value="overrides[item.key]?.base_url || ''" :aria-label="`${chinese ? item.zh : item.en} ${tr('服务地址（可选）', 'service URL')}`" :placeholder="tr('使用提供方地址或适配器默认地址', 'Use the provider URL or adapter default')" @input="patch(item.key, { enabled: true, binding: binding(item.key), base_url: ($event.target as HTMLInputElement).value })"></label><p v-if="item.key === 'search'">{{ tr('请选择此地址实际支持的搜索接口。搜索不使用语言模型协议。', 'Select the search API implemented by this endpoint. Search does not use the language-model protocol.') }}</p><p v-if="item.key === 'videogen'">{{ tr('设置服务配置中的视频提供方。', 'Configure the video provider in service settings.') }}</p></details>
      </div>
    </div>
  </section>
</template>

<style scoped>
.provider-services { border-top: 1px solid var(--border); padding-top: 24px; display: grid; gap: 12px; }
.provider-services-head { display: flex; align-items: center; justify-content: space-between; }
h3, p { margin: 0; } h3 { font-size: 14px; } p, small { color: var(--muted-foreground); font-size: 12px; }
button { border: 0; background: none; text-decoration: underline; cursor: pointer; color: var(--foreground); }
.provider-services-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.provider-service-card { border: 1px solid color-mix(in srgb, var(--border) 70%, transparent); border-radius: 12px; padding: 14px; }
.provider-service-card.enabled { border-color: color-mix(in srgb, var(--primary) 22%, var(--border)); background: color-mix(in srgb, var(--primary) 3%, var(--background)); }
.provider-service-toggle { display: flex; gap: 10px; align-items: start; font-size: 13px; } .provider-service-toggle span { display: grid; gap: 3px; }
.provider-service-card details { border-top: 1px solid var(--border); margin-top: 10px; padding-top: 10px; font-size: 13px; }
.provider-service-card details label { display: grid; gap: 5px; margin-top: 10px; }
.provider-service-card select, .provider-service-card details input { min-height: 34px; border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; background: var(--background); color: var(--foreground); }
@media (max-width: 640px) { .provider-services-grid { grid-template-columns: 1fr; } }
</style>
