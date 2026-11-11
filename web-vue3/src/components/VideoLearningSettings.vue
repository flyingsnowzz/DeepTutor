<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { api, post } from '../api'
import LegacyIcon from './LegacyIcon.vue'
interface Settings { version: 1; default_provider: 'youtube' | 'invidious'; youtube: { transcript_provider: 'youtube_transcript_api' | 'none' }; invidious: { api_base_url: string; public_base_url: string } }
const props = withDefaults(defineProps<{ pending?: unknown; revision?: number }>(), { revision: 0 })
const emit = defineEmits<{ change: [value: Settings]; loaded: [value: Settings] }>()
const defaults: Settings = { version: 1, default_provider: 'youtube', youtube: { transcript_provider: 'youtube_transcript_api' }, invidious: { api_base_url: '', public_base_url: '' } }
const settings = reactive<Settings>(JSON.parse(JSON.stringify(defaults)))
const loading = ref(true)
const testing = ref(false)
const message = ref('')
const error = ref('')
function assign(next: Settings) { settings.version = 1; settings.default_provider = next.default_provider; settings.youtube = { ...next.youtube }; settings.invidious = { ...next.invidious } }
async function load() { loading.value = true; error.value = ''; try { const live = await api<Settings>('/api/settings/video-learning'); assign((props.pending as Settings | undefined) ?? live); emit('loaded', live) } catch (cause) { error.value = cause instanceof Error ? cause.message : '设置加载失败' } finally { loading.value = false } }
onMounted(load); watch(() => props.revision, load)
function changed() { emit('change', { version: 1, default_provider: settings.default_provider, youtube: { ...settings.youtube }, invidious: { ...settings.invidious } }) }
function provider(value: 'youtube' | 'invidious') { settings.default_provider = value; changed() }
async function test() { testing.value = true; message.value = '正在测试 Invidious…'; error.value = ''; try { const result = await post<{ ok: boolean; message: string }>('/api/settings/video-learning/test-invidious', settings); message.value = result.ok ? `Invidious 已连接（${result.message}）。` : `Invidious 不可用：${result.message}` } catch (cause) { message.value = ''; error.value = cause instanceof Error ? cause.message : '连接测试失败' } finally { testing.value = false } }
</script>
<template><div class="video-settings"><header class="legacy-settings-page-header"><h1>视频学习</h1><p>选择原生 YouTube 或自托管 Invidious 实例。切换提供方不会重建学习资料或重置进度。</p></header><p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="loading" class="legacy-settings-loading">加载中…</p><template v-else><div class="video-provider-grid"><button type="button" :class="{ active: settings.default_provider === 'youtube' }" @click="provider('youtube')"><span><LegacyIcon name="video" :size="20" /><strong>原生 YouTube</strong></span><p>官方隐私增强 IFrame 播放器，不代理或存储媒体。</p></button><button type="button" :class="{ active: settings.default_provider === 'invidious' }" @click="provider('invidious')"><span><LegacyIcon name="network" :size="20" /><strong>自托管 Invidious</strong></span><p>通过你配置的 Invidious 实例进行 HTML5 播放。</p></button></div><section class="video-connection"><h2>Invidious 连接</h2><label>后端 API 来源<input v-model="settings.invidious.api_base_url" placeholder="Invidious API URL" @input="changed"></label><label>浏览器访问来源（可选）<input v-model="settings.invidious.public_base_url" placeholder="默认使用 API 来源" @input="changed"></label><button :disabled="testing" @click="test">{{ testing ? '正在测试…' : '测试连接' }}</button></section><label class="video-transcript"><span><strong>YouTube 字幕适配器</strong><small>可选字幕；安装包或字幕不可用时仍可播放。</small></span><select v-model="settings.youtube.transcript_provider" aria-label="YouTube 字幕适配器" @change="changed"><option value="youtube_transcript_api">youtube-transcript-api</option><option value="none">禁用</option></select></label><p v-if="message" class="video-test-message" role="status">✓ {{ message }}</p></template></div></template>
