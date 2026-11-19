<script setup lang="ts">
import { computed, inject, onUnmounted } from 'vue'
import { scopedUrl } from '../workspaceScope'
import LegacyIcon from './LegacyIcon.vue'
import { saveDiagnosticsResult } from '../settingsDiagnostics'
import { modelTestFingerprint } from '../modelTestFingerprint'
import { createModelTestSession, modelTestKey, modelTestSessionKey } from '../modelTestSession'

interface Model { id: string; model?: string; name?: string; context_window?: string; context_window_source?: string; context_window_detected_at?: string; dimension?: string; supported_dimensions?: string; managed_by?: string }
interface Profile { id: string; name?: string; models: Model[]; read_only?: boolean }
const props = defineProps<{ catalog: Record<string, any>; service: string; profile: Profile; model?: Model | null; language?: string }>()
const emit = defineEmits<{ adopt: [value: { context_window?: string; context_window_source?: string; context_window_detected_at?: string; dimension?: string; supported_dimensions?: string }] }>()
const providedSession = inject(modelTestSessionKey, null)
const session = providedSession ?? createModelTestSession()
if (!providedSession) onUnmounted(() => session.dispose())
const chinese = computed(() => (props.language || 'zh').toLowerCase().startsWith('zh'))
const tr = (zh: string, en: string) => chinese.value ? zh : en
const key = computed(() => modelTestKey(props.service, props.profile.id, props.model?.id))
const result = computed(() => session.state.results[key.value])
const state = computed(() => result.value?.state ?? 'idle')
const message = computed(() => result.value?.message ?? '')
const logs = computed(() => result.value?.logs ?? '')
const responseSnippet = computed(() => result.value?.responseSnippet ?? '')
const context = computed(() => result.value?.context ?? null)
const dimension = computed(() => result.value?.dimension ?? null)
const supportedDimensions = computed(() => result.value?.supportedDimensions ?? [])
const usable = computed(() => props.service === 'search' || Boolean(props.model?.model?.trim()))
const currentFingerprint = computed(() => modelTestFingerprint(props.catalog, props.service, props.profile.id, props.model?.id))
const stale = computed(() => Boolean(result.value && result.value.fingerprint !== currentFingerprint.value))
const current = computed(() => Boolean(result.value && !stale.value))
const adopted = computed(() => context.value
  ? Number(props.model?.context_window) === context.value.value
  : dimension.value ? Number(props.model?.dimension) === dimension.value : false)

async function run() {
  if (!usable.value || session.state.runningKey) return
  const service = props.service
  const profileId = props.profile.id
  const modelId = service === 'search' ? null : props.model?.id ?? null
  const runKey = key.value
  const catalog = JSON.parse(JSON.stringify(props.catalog)) as Record<string, any>
  const target = catalog.services[service]
  if (service === 'task') target.mode = 'profiles'
  target.active_profile_id = profileId
  if (service !== 'search') target.active_model_id = modelId
  if (!session.begin(runKey, {
    state: 'running', fingerprint: currentFingerprint.value,
    message: tr('正在测试模型…', 'Testing model…'), logs: '', responseSnippet: '',
    context: null, dimension: null, supportedDimensions: [],
  })) return
  const finish = (next: 'success' | 'failed', text: string) => {
    if (!session.finish(runKey, { state: next, message: text })) return
    saveDiagnosticsResult(service, { state: next, message: text, profileId, modelId })
  }
  try {
    const response = await fetch(scopedUrl(`/api/settings/tests/${service}/start`), {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalog }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload.run_id) throw new Error(typeof payload.detail === 'string' ? payload.detail : tr('无法启动连接测试', 'Could not start diagnostics.'))
    const stream = new EventSource(scopedUrl(`/api/settings/tests/${service}/${payload.run_id}/events`), { withCredentials: true })
    if (!session.attach(stream)) return
    stream.onmessage = event => {
      try {
        const entry = JSON.parse(event.data)
        const previous = session.state.results[runKey]
        session.update(runKey, { logs: `${previous?.logs ?? ''}[${entry.type}] ${entry.message || ''}\n`, message: entry.message || previous?.message || '' })
        if (entry.type === 'response' && entry.snippet) session.update(runKey, { responseSnippet: entry.snippet })
        if (entry.type === 'context_window' && Number(entry.context_window) > 0) session.update(runKey, { context: { value: Number(entry.context_window), source: entry.source || 'metadata', detectedAt: entry.detected_at } })
        if (entry.type === 'capabilities') session.update(runKey, { dimension: Number(entry.detected_dim) || null, supportedDimensions: entry.supported_dimensions || [] })
        if (entry.type === 'completed') finish('success', entry.message || tr('模型响应成功', 'Model responded successfully'))
        if (entry.type === 'failed') finish('failed', entry.message || tr('模型测试失败', 'Model test failed'))
      } catch { finish('failed', tr('无法读取模型测试结果', 'Could not read the model test result.')) }
    }
    stream.onerror = () => finish('failed', tr('测试连接中断', 'Connection to the test was interrupted'))
  } catch (cause) { finish('failed', cause instanceof Error ? cause.message : tr('模型测试失败', 'Model test failed')) }
}
function adopt() {
  if (state.value !== 'success' || !current.value || adopted.value || context.value?.source === 'default' || props.profile.read_only || props.model?.managed_by) return
  emit('adopt', {
    ...(context.value ? { context_window: String(context.value.value), context_window_source: context.value.source, context_window_detected_at: context.value.detectedAt } : {}),
    ...(dimension.value ? { dimension: String(dimension.value), supported_dimensions: supportedDimensions.value.join(',') } : {}),
  })
}
</script>
<template><section class="model-test-panel" :aria-label="tr('模型连接测试', 'Model connection test')"><div class="model-test-heading"><div><h3>{{ service === 'search' ? tr('测试搜索', 'Test search') : tr('测试当前模型', 'Test this model') }}</h3><p>{{ model?.model || profile.name }}</p></div><button :disabled="!usable || Boolean(session.state.runningKey)" @click="run"><LegacyIcon name="activity" :size="14" />{{ state === 'running' ? tr('正在测试模型…', 'Testing model…') : current ? tr('重新测试', 'Test again') : tr('测试模型', 'Test model') }}</button></div><p class="model-test-description">{{ service === 'llm' || service === 'task' ? tr('使用当前配置发送简短请求，并检测上下文窗口。测试不会切换正在使用的模型。', 'Sends a short request and detects the context window using these settings. Your active model stays unchanged.') : service === 'embedding' ? tr('测试嵌入模型并检测维度。只有你选择采用检测结果时，才会更新原有维度。', 'Tests embedding access and detects dimensions. Existing dimensions are kept until you choose to update them.') : tr('使用当前配置发送示例请求。测试不会改变正在使用的配置。', 'Sends a sample request using these settings. Your active configuration stays unchanged.') }}</p><div role="status" aria-live="polite"><p v-if="stale" class="model-test-stale">{{ tr('配置已修改，请重新测试以验证当前设置。', 'Settings changed since the last test. Test again to verify them.') }}</p><div v-if="current" class="model-test-result" :class="state"><p><LegacyIcon :name="state === 'success' ? 'check' : state === 'failed' ? 'close' : 'activity'" :size="15" />{{ state === 'success' ? tr('模型响应成功', 'Model responded successfully') : message }}</p><small v-if="responseSnippet">{{ responseSnippet }}</small><div v-if="context || dimension" class="model-detected"><div><strong>{{ context ? context.source === 'default' ? tr(`上下文容量未知 · 保守预算 ${context.value} tokens`, `Unknown context capacity · conservative budget: ${context.value} tokens`) : tr(`检测到上下文窗口：${context.value} tokens`, `Detected context: ${context.value} tokens`) : tr(`检测到维度：${dimension}`, `Detected dimensions: ${dimension}`) }}</strong><p v-if="context">{{ tr('来源：', 'Source: ') }}{{ context.source }}</p></div><button :disabled="state !== 'success' || !current || adopted || context?.source === 'default' || profile.read_only || Boolean(model?.managed_by)" @click="adopt">{{ context?.source === 'default' ? tr('请手动设置上下文容量', 'Set context capacity manually') : adopted ? tr('已采用', 'Already applied') : tr('采用检测值', 'Use detected value') }}</button></div></div></div><details v-if="current && logs"><summary>{{ tr('测试详情', 'Test details') }}</summary><pre>{{ logs }}</pre></details></section></template>
