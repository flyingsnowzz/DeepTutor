<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { api, post } from '../api'
import LegacyIcon from './LegacyIcon.vue'

type Settings = { version: 1; default_provider: 'youtube' | 'invidious'; youtube: { transcript_provider: 'youtube_transcript_api' | 'none' }; invidious: { api_base_url: string; public_base_url: string } }
const props = withDefaults(defineProps<{ pending?: unknown; revision?: number; language?: string }>(), { revision: 0 })
const emit = defineEmits<{ change: [value: Settings]; loaded: [value: Settings] }>()
const chinese = computed(() => (props.language || 'zh').toLowerCase().startsWith('zh'))
const tr = (zh: string, en: string) => chinese.value ? zh : en
const settings = reactive<Settings>({ version: 1, default_provider: 'youtube', youtube: { transcript_provider: 'youtube_transcript_api' }, invidious: { api_base_url: '', public_base_url: '' } })
const loading = ref(true)
const loaded = ref(false)
const testing = ref(false)
const message = ref('')
const error = ref('')
let loadVersion = 0
let testVersion = 0
function valid(value: unknown): value is Settings {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, any>
  return row.version === 1 && ['youtube', 'invidious'].includes(row.default_provider)
    && ['youtube_transcript_api', 'none'].includes(row.youtube?.transcript_provider)
    && typeof row.invidious?.api_base_url === 'string' && typeof row.invidious?.public_base_url === 'string'
}
async function load() {
  const version = ++loadVersion
  ++testVersion
  loading.value = true; loaded.value = false; error.value = ''; message.value = ''; testing.value = false
  try {
    const live = await api<unknown>('/api/settings/video-learning')
    if (version !== loadVersion) return
    if (!valid(live)) throw new Error(tr('后端返回了无效的视频学习设置。', 'The backend returned an unexpected video learning settings payload.'))
    const selected = (props.pending as Settings | undefined) ?? live
    Object.assign(settings, { version: 1, default_provider: selected.default_provider, youtube: { ...selected.youtube }, invidious: { ...selected.invidious } })
    loaded.value = true
    emit('loaded', live)
  } catch (cause) { if (version === loadVersion) error.value = cause instanceof Error ? cause.message : tr('设置加载失败', 'Settings could not be loaded.') }
  finally { if (version === loadVersion) loading.value = false }
}
onMounted(load)
onUnmounted(() => { loadVersion++; testVersion++ })
watch(() => props.revision, load)
function changed() {
  if (!loaded.value) return
  ++testVersion
  message.value = ''
  testing.value = false
  emit('change', { version: 1, default_provider: settings.default_provider, youtube: { ...settings.youtube }, invidious: { ...settings.invidious } })
}
function provider(value: 'youtube' | 'invidious') { settings.default_provider = value; changed() }
async function test() {
  if (!loaded.value || testing.value) return
  const version = ++testVersion
  testing.value = true; message.value = tr('正在测试 Invidious…', 'Testing Invidious…'); error.value = ''
  try {
    const result = await post<{ ok: boolean; message: string }>('/api/settings/video-learning/test-invidious', { version: 1, default_provider: settings.default_provider, youtube: { ...settings.youtube }, invidious: { ...settings.invidious } })
    if (version === testVersion) message.value = result.ok ? tr(`Invidious 已连接（${result.message}）。`, `Invidious connected (${result.message}).`) : tr(`Invidious 不可用：${result.message}`, `Invidious unavailable: ${result.message}`)
  } catch (cause) {
    if (version === testVersion) { message.value = ''; error.value = cause instanceof Error ? cause.message : tr('连接测试失败', 'Connection test failed.') }
  } finally { if (version === testVersion) testing.value = false }
}
</script>

<template>
  <div class="video-settings">
    <header class="legacy-settings-page-header"><h1>{{ tr('视频学习', 'Video Learning') }}</h1><p>{{ tr('选择原生 YouTube 或自托管 Invidious 实例。切换提供方不会重建学习资料或重置进度。', 'Choose native YouTube or a self-hosted Invidious instance. Provider changes do not rebuild learning materials or reset progress.') }}</p></header>
    <p v-if="loading" class="legacy-settings-loading">{{ tr('加载中…', 'Loading...') }}</p>
    <div v-else-if="error && !loaded" class="error" role="alert"><p>{{ error }}</p><button type="button" @click="load">{{ tr('重试', 'Retry') }}</button></div>
    <template v-else-if="loaded">
      <div class="video-provider-grid"><button type="button" :class="{ active: settings.default_provider === 'youtube' }" @click="provider('youtube')"><span><LegacyIcon name="video" :size="20" /><strong>{{ tr('原生 YouTube', 'Native YouTube') }}</strong></span><p>{{ tr('官方隐私增强 IFrame 播放器，不代理或存储媒体。', 'Official privacy-enhanced IFrame Player. No media is proxied or stored.') }}</p></button><button type="button" :class="{ active: settings.default_provider === 'invidious' }" @click="provider('invidious')"><span><LegacyIcon name="network" :size="20" /><strong>{{ tr('自托管 Invidious', 'Self-hosted Invidious') }}</strong></span><p>{{ tr('通过你配置的 Invidious 实例进行 HTML5 播放。', 'HTML5 playback through your configured Invidious instance.') }}</p></button></div>
      <section class="video-connection"><h2>{{ tr('Invidious 连接', 'Invidious connection') }}</h2><label>{{ tr('后端 API 来源', 'Backend API origin') }}<input v-model="settings.invidious.api_base_url" :placeholder="tr('Invidious API URL', 'Invidious API URL')" @input="changed"></label><label>{{ tr('浏览器访问来源（可选）', 'Browser-facing origin (optional)') }}<input v-model="settings.invidious.public_base_url" :placeholder="tr('默认使用 API 来源', 'Defaults to the API origin')" @input="changed"></label><button :disabled="testing" @click="test">{{ testing ? tr('正在测试…', 'Testing…') : tr('测试连接', 'Test connection') }}</button></section>
      <label class="video-transcript"><span><strong>{{ tr('YouTube 字幕适配器', 'YouTube transcript adapter') }}</strong><small>{{ tr('可选字幕；安装包或字幕不可用时仍可播放。', 'Optional captions; playback remains available when the package or captions are unavailable.') }}</small></span><select v-model="settings.youtube.transcript_provider" :aria-label="tr('YouTube 字幕适配器', 'YouTube transcript adapter')" @change="changed"><option value="youtube_transcript_api">youtube-transcript-api</option><option value="none">{{ tr('禁用', 'Disabled') }}</option></select></label>
      <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="message" class="video-test-message" role="status">{{ message }}</p>
    </template>
  </div>
</template>
