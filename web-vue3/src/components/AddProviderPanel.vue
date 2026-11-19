<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ProviderIcon from './ProviderIcon.vue'
import { formatProviderLabel } from '../providerBranding'

type Option = { value: string; label?: string; services: string[]; service: string; default_api_format?: string }
const props = defineProps<{ options: Option[]; language?: string }>()
const emit = defineEmits<{ create: [option: Option, custom?: { name: string; base_url: string; api_format: string }]; cancel: [] }>()
const chinese = computed(() => (props.language || 'zh').toLowerCase().startsWith('zh'))
const tr = (zh: string, en: string) => chinese.value ? zh : en
const filters = ['all', 'multi', 'llm', 'embedding', 'voice', 'search', 'imagegen', 'videogen', 'custom']
const filterLabels: Record<string, [string, string]> = {
  all: ['全部', 'All'], multi: ['多服务', 'Multiple services'], llm: ['语言模型', 'Language models'],
  embedding: ['嵌入', 'Embedding'], voice: ['语音', 'Voice'], search: ['搜索', 'Search'],
  imagegen: ['图片', 'Images'], videogen: ['视频', 'Video'], custom: ['自定义', 'Custom'],
}
const filter = ref('all')
const query = ref('')
const vendor = ref('')
const name = ref('')
const url = ref('')
const protocol = ref('openai_chat')
const visible = computed(() => props.options.map(option => ({
  ...option,
  label: formatProviderLabel(option.value, option.label || option.value, props.language || 'zh'),
})).filter(option => {
  const category = filter.value === 'all' || (filter.value === 'custom' ? option.value === 'custom' : option.value !== 'custom' && (filter.value === 'multi' ? option.services.length > 1 : filter.value === 'voice' ? option.services.some(service => service === 'tts' || service === 'stt') : option.services.includes(filter.value)))
  return category && `${option.label || ''} ${option.value}`.toLowerCase().includes(query.value.trim().toLowerCase())
}))
const selected = computed(() => props.options.find(option => option.value === vendor.value))
const validUrl = computed(() => {
  try {
    const parsed = new URL(url.value)
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && Boolean(parsed.hostname)
  } catch { return false }
})
const canCreate = computed(() => Boolean(selected.value && (vendor.value !== 'custom' || (name.value.trim() && validUrl.value))))
watch(filter, () => { vendor.value = '' })
function create() {
  if (!canCreate.value || !selected.value) return
  emit('create', selected.value, vendor.value === 'custom' ? { name: name.value.trim(), base_url: url.value.trim(), api_format: protocol.value } : undefined)
}
const serviceLabels: Record<string, [string, string]> = {
  llm: ['语言模型', 'Language models'], task: ['后台任务模型', 'Task model'], embedding: ['嵌入模型', 'Embedding models'],
  search: ['搜索', 'Search'], tts: ['语音合成', 'Text-to-Speech'], stt: ['语音识别', 'Speech-to-Text'],
  imagegen: ['文生图', 'Image Generation'], videogen: ['文生视频', 'Video Generation'],
}
function serviceLabel(service: string) {
  const label = serviceLabels[service]
  return label ? (chinese.value ? label[0] : label[1]) : service
}
</script>

<template>
  <section class="add-provider-panel" :aria-label="tr('添加提供方', 'Add provider')">
    <h2>{{ tr('添加提供方', 'Add provider') }}</h2>
    <input v-model="query" type="search" :aria-label="tr('搜索提供方', 'Search providers')" :placeholder="tr('搜索提供方', 'Search providers')">
    <div class="provider-filters" role="group" :aria-label="tr('筛选提供方类型', 'Filter provider types')"><button v-for="item in filters" :key="item" type="button" :aria-pressed="filter === item" @click="filter = item">{{ tr(...filterLabels[item]) }}</button></div>
    <div class="provider-options" role="radiogroup" :aria-label="tr('提供方类型', 'Provider type')">
      <label v-for="option in visible" :key="option.value" class="provider-option" :class="{ selected: vendor === option.value }"><input v-model="vendor" type="radio" name="provider-type" :value="option.value" :aria-label="option.value === 'custom' ? tr('自定义', 'Custom') : option.label || option.value"><span><ProviderIcon :provider="option.value" :size="20" />{{ option.value === 'custom' ? tr('自定义', 'Custom') : option.label || option.value }}</span><small v-if="option.value === 'custom'">{{ tr('自有地址与支持的接口协议', 'Your own URL and supported API protocol') }}</small><span v-else class="provider-option-tags"><small v-for="service in option.services" :key="service">{{ serviceLabel(service) }}</small></span></label>
    </div>
    <p v-if="!visible.length" role="status">{{ tr('没有匹配的提供方。', 'No providers match your search.') }}</p>
    <div v-if="vendor === 'custom'" class="custom-provider"><label>{{ tr('提供方名称', 'Provider name') }}<input v-model="name" :aria-label="tr('自定义提供方名称', 'Custom provider name')"></label><label>{{ tr('提供方地址', 'Provider URL') }}<input v-model="url" :aria-label="tr('提供方地址', 'Provider URL')"></label><p v-if="url && !validUrl" role="status">{{ tr('请输入有效的 HTTP 或 HTTPS 提供方地址。', 'Enter a valid HTTP or HTTPS provider address.') }}</p><label>{{ tr('语言模型接口协议', 'Language-model API protocol') }}<select v-model="protocol" :aria-label="tr('语言模型接口协议', 'Language-model API protocol')"><option value="openai_chat">OpenAI Chat Completions</option><option value="openai_responses">OpenAI Responses</option><option value="anthropic">Anthropic Messages</option></select></label><p>{{ tr('此地址需要实现所选协议。下一步填写凭据，并按需增加其他服务类型及其适配器。', 'The URL must implement the selected API. On the next step, add credentials and choose any additional service types and their adapters.') }}</p></div>
    <p class="add-provider-hint">{{ tr('标签表示已有内置适配器，不代表账号权限。同一连接可以用于多类模型，不同账号或独立产品也可以分别添加。', 'Tags show built-in integrations, not account permissions. One connection can serve several model types; separate accounts and products can have separate connections.') }}</p>
    <div class="add-provider-actions"><button type="button" class="primary" :disabled="!canCreate" @click="create">{{ tr('继续', 'Continue') }}</button><button type="button" @click="emit('cancel')">{{ tr('取消', 'Cancel') }}</button></div>
  </section>
</template>

<style scoped>
.add-provider-panel { display: grid; gap: 18px; padding: 20px; border: 1px solid var(--border); border-radius: 14px; }
h2, p { margin: 0; } h2 { font-size: 17px; } input, select { border: 1px solid var(--border); border-radius: 7px; padding: 8px 10px; background: var(--background); color: var(--foreground); }
.provider-filters { display: flex; flex-wrap: wrap; gap: 6px; }.provider-filters button { border: 1px solid var(--border); border-radius: 999px; padding: 6px 12px; }.provider-filters button[aria-pressed="true"] { background: var(--foreground); color: var(--background); }
.provider-options { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); gap: 10px; max-height: min(28rem, 50dvh); overflow-y: auto; }
.provider-option { display: grid; gap: 12px; min-height: 96px; padding: 16px; border: 1px solid var(--border); border-radius: 12px; cursor: pointer; }.provider-option.selected { border-color: var(--primary); background: var(--accent); }.provider-option input { position: absolute; opacity: 0; width: 1px; height: 1px; }.provider-option>span { display: flex; gap: 10px; align-items: flex-start; font-weight: 600; }.provider-option small { color: var(--muted-foreground); }.provider-option-tags { display: flex; flex-wrap: wrap; gap: 6px; }.provider-option-tags small { padding: 2px 8px; border-radius: 999px; background: var(--muted); font-size: 12px; }
.custom-provider { display: grid; gap: 12px; border: 1px solid var(--border); border-radius: 10px; padding: 14px; }.custom-provider label { display: grid; gap: 6px; }.custom-provider p { color: #dc2626; }
.add-provider-hint { font-size: 13px; line-height: 1.6; }
.add-provider-actions { display: flex; gap: 8px; border-top: 1px solid var(--border); padding-top: 14px; }.add-provider-actions button { border: 1px solid var(--border); border-radius: 7px; padding: 8px 13px; }.add-provider-actions .primary { background: var(--primary); color: white; }.add-provider-actions button:disabled { opacity: .5; }
</style>
