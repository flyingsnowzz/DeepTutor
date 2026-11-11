<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { api } from '../api'

interface NetworkSettings { backend_port: number; frontend_port: number; public_api_base: string; cors_origins: string[] }
interface NetworkPayload { settings: NetworkSettings; effective: { backend_url: string; frontend_url: string; browser_api_base: string; api_base_source: string; cors_mode: 'explicit' | 'permissive'; cors_origins: string[]; allow_remote_http_origins: boolean }; auth: { enabled: boolean; cookie_secure: boolean; cookie_samesite: string; cross_site_cookie_ready: boolean }; restart_required: boolean }
const props = defineProps<{ pending?: unknown; revision: number }>()
const emit = defineEmits<{ change: [value: NetworkSettings]; loaded: [value: NetworkSettings] }>()
const payload = ref<NetworkPayload | null>(null)
const draft = reactive<NetworkSettings>({ backend_port: 8001, frontend_port: 3783, public_api_base: '', cors_origins: [] })
const corsText = ref('')
const loading = ref(true)
const error = ref('')
function normalizeOrigins(value: string) { return value.split(/[,;\n]+/).map(item => item.trim()).filter(Boolean) }
function currentDraft(): NetworkSettings { return { ...draft, cors_origins: normalizeOrigins(corsText.value) } }
function update() { emit('change', currentDraft()) }
async function load() {
  loading.value = true
  error.value = ''
  try {
    const next = await api<NetworkPayload>('/api/settings/network')
    payload.value = next
    const pending = props.pending as NetworkSettings | undefined
    Object.assign(draft, pending ?? next.settings)
    corsText.value = (pending?.cors_origins ?? next.settings.cors_origins ?? []).join('\n')
    emit('loaded', { ...next.settings })
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '网络设置加载失败' }
  finally { loading.value = false }
}
onMounted(load)
watch(() => props.revision, load)
</script>

<template>
  <div>
    <header class="legacy-settings-page-header"><h1>网络</h1><p>控制 Docker、局域网与反向代理部署中浏览器使用的 API 地址和 CORS 来源。</p></header>
    <p class="legacy-network-restart">网络更改会在重启后生效。</p>
    <p v-if="loading" class="legacy-settings-loading">正在加载网络设置…</p><p v-else-if="error" class="error" role="alert">{{ error }}</p>
    <template v-else-if="payload">
      <div class="legacy-network-tiles"><div><small>浏览器 API</small><strong>{{ payload.effective.browser_api_base }}</strong><span>可访问</span></div><div><small>CORS 模式</small><strong>{{ payload.effective.cors_mode === 'permissive' ? '启用鉴权前允许跨源' : '需要明确配置来源' }}</strong><span :class="{ warn: payload.effective.cors_mode !== 'permissive' }">{{ payload.effective.cors_mode === 'permissive' ? '可访问' : '需检查' }}</span></div><div><small>鉴权 Cookie</small><strong>{{ payload.auth.cookie_samesite }}{{ payload.auth.cookie_secure ? ' + Secure' : '' }}</strong><span :class="{ warn: payload.auth.enabled && !payload.auth.cross_site_cookie_ready }">{{ !payload.auth.enabled || payload.auth.cross_site_cookie_ready ? '可访问' : '需检查' }}</span></div><div><small>重启</small><strong>保存后需要重启</strong><span class="warn">需注意</span></div></div>
      <section class="legacy-setting-section"><header><h2>运行端口</h2><p>这些端口会在启动时读取。Docker 端口映射必须与容器内端口一致。</p></header><div class="legacy-setting-section-body">
        <div class="legacy-setting-row"><div><h3>后端端口</h3><p>FastAPI 在此端口监听。</p></div><input v-model.number="draft.backend_port" class="legacy-setting-number" type="number" min="1" max="65535" aria-label="后端端口" @input="update"></div>
        <div class="legacy-setting-row"><div><h3>前端端口</h3><p>Web UI 在此端口提供服务。</p></div><input v-model.number="draft.frontend_port" class="legacy-setting-number" type="number" min="1" max="65535" aria-label="前端端口" @input="update"></div>
      </div></section>
      <section class="legacy-setting-section"><header><h2>浏览器 API 地址</h2><p>当浏览器无法通过 localhost 访问后端时配置，例如远程 Docker 或反向代理。</p></header><div class="legacy-setting-section-body"><div class="legacy-setting-row"><div><h3>公开 API 地址</h3><p>本地 Docker 可留空。远程部署请填写可访问的后端 URL，包含代理路径。</p></div><input v-model="draft.public_api_base" class="legacy-network-input" :placeholder="payload.effective.browser_api_base" aria-label="公开 API 地址" @input="update"></div></div></section>
      <section class="legacy-setting-section"><header><h2>CORS 来源</h2><p>仅在启用鉴权的跨源部署中需要。请填写前端来源，而不是 API URL。</p></header><div class="legacy-setting-section-body"><div class="legacy-network-cors"><textarea v-model="corsText" aria-label="CORS 来源" placeholder="https://deeptutor.example.com&#10;https://app.example.com" @input="update"/><p>支持逗号、分号和换行分隔。不带协议的 host:port 会保存为 http://host:port。</p></div></div></section>
      <div v-if="payload.auth.enabled && !payload.auth.cookie_secure" class="legacy-network-warning">已启用鉴权，但 Secure Cookie 未开启。跨站 HTTPS 部署应设置 auth.cookie_secure=true 并重启，以便现代浏览器接受 SameSite=None Cookie。</div>
    </template>
  </div>
</template>
