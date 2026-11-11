<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api, post } from '../api'

interface ModelOption { slug: string; display_name: string; efforts?: string[] }
interface BackendOptions { kind: string; display_name: string; available: boolean; version: string; detail: string; models: ModelOption[]; efforts: string[]; allow_custom_model: boolean }
const props = defineProps<{ kind: string }>()
const options = ref<BackendOptions | null>(null)
const config = reactive<Record<string, any>>({}) 
const isAdmin = ref(false)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const customModel = ref(false)
const featureMap: Record<string, string[]> = {
  claude_code: ['effort', 'prompt', 'permission', 'images'],
  codex: ['effort', 'sandbox', 'images'],
  grok: ['effort', 'prompt', 'permission'],
  antigravity: ['effort', 'prompt', 'permission'],
  kimi: ['prompt', 'auto', 'thinking'],
  opencode: ['effort', 'prompt', 'auto', 'images'],
  mimo: ['effort', 'prompt', 'auto', 'images'],
  hermes: ['effort', 'prompt', 'auto', 'images'],
  hermes_remote: ['effort', 'prompt', 'auto'],
  openclaw: ['effort', 'prompt', 'images'],
  deepseek_harness: ['effort', 'prompt', 'images'],
}
const features = computed(() => featureMap[props.kind] || featureMap.claude_code)
const effortChoices = computed(() => options.value?.models.find(model => model.slug === config.model)?.efforts?.length ? options.value.models.find(model => model.slug === config.model)!.efforts! : options.value?.efforts || [])
const permissionModes = computed(() => props.kind === 'grok'
  ? ['dontAsk', 'plan', 'default', 'acceptEdits', 'auto', 'bypassPermissions']
  : ['bypassPermissions', 'acceptEdits', 'default', 'plan'])
const extraArgs = computed({ get: () => (config.extra_args || []).join(' '), set: (value: string) => { config.extra_args = value.split(/\s+/).filter(Boolean) } })
function defaults() {
  return { enabled: true, model: '', effort: '', system_prompt: '', permission_mode: props.kind === 'grok' ? 'dontAsk' : 'bypassPermissions', sandbox: 'workspace-write', approval: 'never', network_access: false, ephemeral: false, auto_approve: true, thinking: true, forward_images: false, extra_args: [], base_url: '', api_key_env: 'DEEPTUTOR_HERMES_REMOTE_API_KEY', profile: '', idle_timeout_seconds: 600 }
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    const [optionResult, settings, auth] = await Promise.all([
      api<{ backends: BackendOptions[] }>('/api/subagents/backends/options'),
      api<{ backends: Record<string, Record<string, any>> }>('/api/subagents/settings'),
      api<{ is_admin?: boolean }>('/api/auth/status'),
    ])
    options.value = optionResult.backends.find(item => item.kind === props.kind) || null
    Object.assign(config, defaults(), settings.backends?.[props.kind] || {})
    isAdmin.value = Boolean(auth.is_admin)
    customModel.value = Boolean(config.model && !options.value?.models.some(model => model.slug === config.model))
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '智能体设置加载失败' }
  finally { loading.value = false }
}
onMounted(load)
async function sync() {
  busy.value = true
  error.value = ''
  try { options.value = await post(`/api/subagents/backends/${encodeURIComponent(props.kind)}/sync`, {}); notice.value = '模型列表已同步' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '同步失败' }
  finally { busy.value = false }
}
function chooseModel(value: string) {
  if (value === '__custom__') { customModel.value = true; return }
  customModel.value = false
  config.model = value
  const model = options.value?.models.find(item => item.slug === value)
  if (config.effort && model?.efforts?.length && !model.efforts.includes(config.effort)) config.effort = ''
}
async function save() {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = await api<{ backends: Record<string, Record<string, any>> }>('/api/subagents/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backends: { [props.kind]: { ...config, extra_args: [...(config.extra_args || [])] } } }),
    })
    Object.assign(config, defaults(), result.backends?.[props.kind] || {})
    notice.value = '智能体设置已保存'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败' }
  finally { busy.value = false }
}
</script>

<template>
  <section class="subagent-settings">
    <header class="feature-heading"><div><h2>{{ options?.display_name || kind }}</h2><p>{{ options?.available ? `可用 · ${options.version}` : options?.detail || '检查本机智能体运行时与模型。' }}</p></div><button v-if="kind !== 'hermes_remote'" :disabled="busy" @click="sync">同步模型列表</button></header>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p><p v-if="loading">加载中…</p>
    <template v-else>
      <p v-if="!isAdmin" class="muted">只有管理员可以修改部署级智能体设置。</p>
      <fieldset :disabled="!isAdmin || busy" class="settings-form">
        <label class="settings-check"><input v-model="config.enabled" type="checkbox"> 在对话中启用该智能体</label>
        <label>模型<select :value="customModel ? '__custom__' : config.model" aria-label="智能体模型" @change="chooseModel(($event.target as HTMLSelectElement).value)"><option value="">运行时默认</option><option v-for="model in options?.models || []" :key="model.slug" :value="model.slug">{{ model.display_name }}</option><option v-if="options?.allow_custom_model" value="__custom__">自定义…</option></select></label>
        <label v-if="customModel">自定义模型<input v-model="config.model" aria-label="自定义智能体模型"></label>
        <label v-if="features.includes('effort')">推理强度<select v-if="kind !== 'grok'" v-model="config.effort" aria-label="智能体推理强度"><option value="">运行时默认</option><option v-for="effort in effortChoices" :key="effort" :value="effort">{{ effort }}</option></select><input v-else v-model="config.effort" aria-label="智能体推理强度" placeholder="留空使用 CLI 默认值"></label>
        <label v-if="features.includes('prompt')">系统提示<textarea v-model="config.system_prompt" rows="4" placeholder="留空使用默认委派提示" /></label>
        <label v-if="features.includes('permission')">权限模式<select v-model="config.permission_mode"><option v-for="mode in permissionModes" :key="mode" :value="mode">{{ mode }}</option></select></label>
        <label v-if="features.includes('auto')" class="settings-check"><input v-model="config.auto_approve" type="checkbox"> 自动批准权限请求</label>
        <label v-if="features.includes('thinking')" class="settings-check"><input v-model="config.thinking" type="checkbox"> 流式展示思考过程</label>
        <template v-if="features.includes('sandbox')"><label>沙箱<select v-model="config.sandbox"><option value="read-only">只读</option><option value="workspace-write">工作目录可写</option><option value="danger-full-access">完全访问</option><option value="bypass">绕过沙箱与审批</option></select></label><label>审批策略<select v-model="config.approval"><option value="never">从不询问</option><option value="on-failure">失败时询问</option><option value="on-request">按需询问</option><option value="untrusted">不可信命令时询问</option></select></label><label class="settings-check"><input v-model="config.network_access" type="checkbox"> 允许命令联网</label><label class="settings-check"><input v-model="config.ephemeral" type="checkbox"> 临时会话</label></template>
        <label v-if="features.includes('images')" class="settings-check"><input v-model="config.forward_images" type="checkbox"> 向智能体转发图片</label>
        <label>额外命令行参数<input v-model="extraArgs" placeholder="以空格分隔"></label>
        <template v-if="kind === 'hermes_remote'"><label>网关 URL<input v-model="config.base_url" type="url"></label><label>密钥环境变量<input v-model="config.api_key_env"></label><label>配置 Profile<input v-model="config.profile"></label><label>空闲超时（秒）<input v-model.number="config.idle_timeout_seconds" type="number" min="1"></label></template>
      </fieldset>
      <button class="primary" :disabled="!isAdmin || busy" @click="save">保存智能体设置</button>
    </template>
  </section>
</template>
