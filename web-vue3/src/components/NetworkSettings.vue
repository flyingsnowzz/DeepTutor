<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { api } from '../api'
import RuntimeStatusSettings from './RuntimeStatusSettings.vue'

interface NetworkSettings { backend_port: number; frontend_port: number; public_api_base: string; cors_origins: string[] }
interface NetworkPayload { settings: NetworkSettings; effective: { backend_url: string; frontend_url: string; browser_api_base: string; api_base_source: string; cors_mode: 'explicit' | 'permissive'; cors_origins: string[]; allow_remote_http_origins: boolean }; auth: { enabled: boolean; cookie_secure: boolean; cookie_samesite: string; cross_site_cookie_ready: boolean }; restart_required: boolean }
const props = defineProps<{ pending?: unknown; revision: number; language?: string }>()
const chinese = computed(() => (props.language || 'zh').toLowerCase().startsWith('zh'))
const tr = (zh: string, en: string) => chinese.value ? zh : en
const emit = defineEmits<{ change: [value: NetworkSettings]; loaded: [value: NetworkSettings] }>()
const payload = ref<NetworkPayload | null>(null)
const draft = reactive<NetworkSettings>({ backend_port: 8001, frontend_port: 3783, public_api_base: '', cors_origins: [] })
const corsText = ref('')
const loading = ref(true)
const error = ref('')
let loadVersion = 0
function normalizeOrigins(value: string) { return value.split(/[,;\n]+/).map(item => item.trim()).filter(Boolean) }
function currentDraft(): NetworkSettings { return { ...draft, cors_origins: normalizeOrigins(corsText.value) } }
function update() { emit('change', currentDraft()) }
async function load() {
  const version = ++loadVersion
  loading.value = true
  error.value = ''
  try {
    const next = await api<NetworkPayload>('/api/settings/network')
    if (version !== loadVersion) return
    payload.value = next
    const pending = props.pending as NetworkSettings | undefined
    Object.assign(draft, pending ?? next.settings)
    corsText.value = (pending?.cors_origins ?? next.settings.cors_origins ?? []).join('\n')
    emit('loaded', { ...next.settings })
  } catch (cause) { if (version === loadVersion) error.value = cause instanceof Error ? cause.message : tr('网络设置加载失败', 'Failed to load network settings.') }
  finally { if (version === loadVersion) loading.value = false }
}
onMounted(load)
watch(() => props.revision, load)
onUnmounted(() => { loadVersion += 1 })
</script>

<template>
  <div>
    <header class="legacy-settings-page-header"><h1>{{ tr('网络', 'Network') }}</h1><p>{{ tr('控制 Docker、局域网与反向代理部署中浏览器使用的 API 地址和 CORS 来源。', 'Control the browser-facing API URL and CORS origins used by Docker, LAN, and reverse-proxy deployments.') }}</p></header>
    <p class="legacy-network-restart">{{ tr('网络更改会在重启后生效。', 'Network changes take effect after restart.') }}</p>
    <RuntimeStatusSettings :language="language" />
    <p v-if="loading" class="legacy-settings-loading">{{ tr('正在加载网络设置…', 'Loading network settings...') }}</p><p v-else-if="error" class="error" role="alert">{{ error }}</p>
    <template v-else-if="payload">
      <div class="legacy-network-tiles"><div><small>{{ tr('浏览器 API', 'Browser API') }}</small><strong>{{ payload.effective.browser_api_base }}</strong><span>{{ tr('可访问', 'Ready') }}</span></div><div><small>{{ tr('CORS 模式', 'CORS mode') }}</small><strong>{{ payload.effective.cors_mode === 'permissive' ? tr('启用鉴权前允许跨源', 'Permissive until auth is enabled') : tr('需要明确配置来源', 'Explicit origins required') }}</strong><span :class="{ warn: payload.effective.cors_mode !== 'permissive' }">{{ payload.effective.cors_mode === 'permissive' ? tr('可访问', 'Ready') : tr('需检查', 'Check') }}</span></div><div><small>{{ tr('鉴权 Cookie', 'Auth cookie') }}</small><strong>{{ payload.auth.cookie_samesite }}{{ payload.auth.cookie_secure ? ' + Secure' : '' }}</strong><span :class="{ warn: payload.auth.enabled && !payload.auth.cross_site_cookie_ready }">{{ !payload.auth.enabled || payload.auth.cross_site_cookie_ready ? tr('可访问', 'Ready') : tr('需检查', 'Check') }}</span></div><div><small>{{ tr('重启', 'Restart') }}</small><strong>{{ tr('保存后需要重启', 'Required after save') }}</strong><span class="warn">{{ tr('需注意', 'Attention') }}</span></div></div>
      <section class="legacy-setting-section"><header><h2>{{ tr('运行端口', 'Runtime ports') }}</h2><p>{{ tr('这些端口会在启动时读取。Docker 端口映射必须与容器内端口一致。', 'These ports are read during startup. Docker port mappings must match the container-side values.') }}</p></header><div class="legacy-setting-section-body">
        <div class="legacy-setting-row"><div><h3>{{ tr('后端端口', 'Backend port') }}</h3><p>{{ tr('FastAPI 在此端口监听。', 'FastAPI listens on this port.') }}</p></div><input v-model.number="draft.backend_port" class="legacy-setting-number" type="number" min="1" max="65535" :aria-label="tr('后端端口', 'Backend port')" @input="update"></div>
        <div class="legacy-setting-row"><div><h3>{{ tr('前端端口', 'Frontend port') }}</h3><p>{{ tr('Web UI 在此端口提供服务。', 'The Web UI is served on this port.') }}</p></div><input v-model.number="draft.frontend_port" class="legacy-setting-number" type="number" min="1" max="65535" :aria-label="tr('前端端口', 'Frontend port')" @input="update"></div>
      </div></section>
      <section class="legacy-setting-section"><header><h2>{{ tr('浏览器 API 地址', 'Browser API base') }}</h2><p>{{ tr('当浏览器无法通过 localhost 访问后端时配置，例如远程 Docker 或反向代理。', 'Set this when the browser cannot reach the backend through localhost, such as remote Docker or a reverse proxy.') }}</p></header><div class="legacy-setting-section-body"><div class="legacy-setting-row"><div><h3>{{ tr('公开 API 地址', 'Public API base') }}</h3><p>{{ tr('本地 Docker 可留空。远程部署请填写可访问的后端 URL，包含代理路径。', 'Leave blank for local Docker. Use the externally reachable backend URL, including any proxy path.') }}</p></div><input v-model="draft.public_api_base" class="legacy-network-input" :placeholder="payload.effective.browser_api_base" :aria-label="tr('公开 API 地址', 'Public API base')" @input="update"></div></div></section>
      <section class="legacy-setting-section"><header><h2>{{ tr('CORS 来源', 'CORS origins') }}</h2><p>{{ tr('仅在启用鉴权的跨源部署中需要。请填写前端来源，而不是 API URL。', 'Only required for authenticated cross-origin deployments. Use frontend origins, not API URLs.') }}</p></header><div class="legacy-setting-section-body"><div class="legacy-network-cors"><textarea v-model="corsText" :aria-label="tr('CORS 来源', 'CORS origins')" placeholder="https://deeptutor.example.com&#10;https://app.example.com" @input="update"/><p>{{ tr('支持逗号、分号和换行分隔。不带协议的 host:port 会保存为 http://host:port。', 'Comma, semicolon, and newline separators are accepted. Bare host:port values are stored as http://host:port.') }}</p></div></div></section>
      <div v-if="payload.auth.enabled && !payload.auth.cookie_secure" class="legacy-network-warning">{{ tr('已启用鉴权，但 Secure Cookie 未开启。跨站 HTTPS 部署应设置 auth.cookie_secure=true 并重启，以便现代浏览器接受 SameSite=None Cookie。', 'Auth is enabled but secure cookies are off. Cross-site HTTPS deployments should set auth.cookie_secure=true and restart so SameSite=None cookies work in modern browsers.') }}</div>
    </template>
  </div>
</template>
