<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import {
  buildSshForwardCommand,
  cancelCodexLogin,
  codexErrorMessage,
  codexStatusMessage,
  completeCodexLogin,
  getCodexStatus,
  isLoopbackHostname,
  logoutCodex,
  refreshCodexModels,
  setCodexReasoningEffort,
  shouldPollCodexStatus,
  startCodexLogin,
  type CodexLoginStart,
  type CodexOAuthStatus,
  type CodexReasoningModel,
  CodexOAuthApiError,
} from '../providerAuth'

/** Vue3 port of web/components/settings/CodexOAuthCard.tsx. */
const emit = defineEmits<{ catalogChanged: [] }>()

const status = ref<CodexOAuthStatus | null>(null)
const pending = ref(false)
const errorText = ref('')
const loginStart = ref<CodexLoginStart | null>(null)
const callbackUrl = ref('')
const efforts = ref<Record<string, string | null>>({})
let pollTimer: number | null = null
let sequence = 0

const remoteAccess = computed(() =>
  typeof window !== 'undefined' ? !isLoopbackHostname(window.location.hostname) : false)
const connected = computed(() => status.value?.connection === 'connected')
const polling = computed(() => Boolean(status.value && shouldPollCodexStatus(status.value)))
const callbackPort = computed(() => status.value?.callback_port ?? loginStart.value?.callback_port ?? null)

const remoteGuidance = computed(() => {
  const current = status.value
  if (current?.operation_state !== 'waiting' || !current.operation_id) return null
  const matchingStart = loginStart.value?.operation_id === current.operation_id ? loginStart.value : null
  const authorizeUrl = current.authorize_url ?? matchingStart?.authorize_url
  const expiresIn = current.expires_in ?? matchingStart?.expires_in
  const port = current.callback_port ?? matchingStart?.callback_port
  const forwardPort = current.callback_forward_port ?? matchingStart?.callback_forward_port
  const redirectUri = current.redirect_uri ?? matchingStart?.redirect_uri
  if (!authorizeUrl || expiresIn == null || port == null || forwardPort == null || !redirectUri) return null
  return { operation_id: current.operation_id, authorize_url: authorizeUrl, expires_in: expiresIn, callback_port: port, callback_forward_port: forwardPort, redirect_uri: redirectUri }
})
const sshCommand = computed(() => remoteGuidance.value
  ? buildSshForwardCommand(remoteGuidance.value.callback_port, window.location.hostname, remoteGuidance.value.callback_forward_port)
  : '')
const statusText = computed(() => {
  if (errorText.value) return errorText.value
  return status.value ? codexStatusMessage(status.value) : ''
})

function applyStatus(next: CodexOAuthStatus) {
  status.value = next
  efforts.value = Object.fromEntries(next.models.map(model => [model.model, model.reasoning_effort || null]))
  const terminal = ['completed', 'cancelled', 'expired', 'failed'].includes(next.operation_state ?? '')
  if (terminal) {
    callbackUrl.value = ''
    if (loginStart.value && next.operation_id === loginStart.value.operation_id) loginStart.value = null
  }
}

function errorCode(cause: unknown): string | null {
  return cause instanceof CodexOAuthApiError ? cause.code : null
}

async function loadStatus() {
  const requestSequence = ++sequence
  try {
    const next = await getCodexStatus()
    if (requestSequence !== sequence) return
    applyStatus(next)
    errorText.value = ''
  } catch (cause) {
    if (requestSequence !== sequence) return
    errorText.value = codexErrorMessage(errorCode(cause), cause instanceof Error ? cause.message : undefined)
  }
}

function schedulePoll() {
  if (pollTimer !== null) { window.clearTimeout(pollTimer); pollTimer = null }
  if (!polling.value || pending.value) return
  pollTimer = window.setTimeout(async () => {
    await loadStatus()
    schedulePoll()
  }, 1000)
}

onMounted(loadStatus)
onBeforeUnmount(() => { if (pollTimer !== null) window.clearTimeout(pollTimer) })

watch([status, pending], schedulePoll)
watch(() => status.value?.operation_state, (state, previous) => {
  if (state === 'completed' && previous !== 'completed') emit('catalogChanged')
})

async function localSignIn() {
  sequence++
  const authWindow = window.open('about:blank', '_blank', 'popup')
  if (authWindow) authWindow.opener = null
  pending.value = true
  errorText.value = ''
  try {
    const started = await startCodexLogin()
    if (authWindow) authWindow.location.replace(started.authorize_url)
    else window.location.assign(started.authorize_url)
    await loadStatus()
  } catch (cause) {
    authWindow?.close()
    errorText.value = codexErrorMessage(errorCode(cause), cause instanceof Error ? cause.message : undefined)
  } finally {
    pending.value = false
  }
}

async function remoteSignIn() {
  sequence++
  pending.value = true
  errorText.value = ''
  try {
    loginStart.value = await startCodexLogin()
    await loadStatus()
  } catch (cause) {
    errorText.value = codexErrorMessage(errorCode(cause), cause instanceof Error ? cause.message : undefined)
  } finally {
    pending.value = false
  }
}
function signIn() { return remoteAccess.value ? remoteSignIn() : localSignIn() }

async function copyCommand() {
  if (!sshCommand.value) return
  try {
    await navigator.clipboard.writeText(sshCommand.value)
  } catch { /* Clipboard unavailable; the command remains visible for manual copy. */ }
}
function openAuthorization() {
  if (remoteGuidance.value) window.open(remoteGuidance.value.authorize_url, '_blank', 'noopener')
}

async function cancel() {
  sequence++
  pending.value = true
  try {
    applyStatus(await cancelCodexLogin())
    loginStart.value = null
  } catch (cause) {
    errorText.value = codexErrorMessage(errorCode(cause), cause instanceof Error ? cause.message : undefined)
  } finally {
    pending.value = false
  }
}

async function refreshModels() {
  sequence++
  pending.value = true
  try {
    applyStatus(await refreshCodexModels())
    emit('catalogChanged')
    errorText.value = ''
  } catch (cause) {
    errorText.value = codexErrorMessage(errorCode(cause), cause instanceof Error ? cause.message : undefined)
  } finally {
    pending.value = false
  }
}

async function logout() {
  sequence++
  pending.value = true
  try {
    applyStatus(await logoutCodex())
    loginStart.value = null
    emit('catalogChanged')
    errorText.value = ''
  } catch (cause) {
    errorText.value = codexErrorMessage(errorCode(cause), cause instanceof Error ? cause.message : undefined)
  } finally {
    pending.value = false
  }
}

async function submitCallbackUrl() {
  const pasted = callbackUrl.value.trim()
  if (!pasted) return
  sequence++
  pending.value = true
  errorText.value = ''
  try {
    applyStatus(await completeCodexLogin(pasted))
    callbackUrl.value = ''
  } catch (cause) {
    errorText.value = codexErrorMessage(errorCode(cause), cause instanceof Error ? cause.message : undefined)
  } finally {
    pending.value = false
  }
}

function reasoningOptions(model: CodexReasoningModel): { value: string; label: string }[] {
  const labels: Record<string, string> = {
    '': '提供方默认（自动）', none: 'None', minimal: 'Minimal', low: 'Low',
    medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Maximum', adaptive: 'Adaptive',
  }
  return ['', ...new Set(model.supported_reasoning_levels || [])]
    .map(value => ({ value, label: labels[value] ?? value }))
}

async function changeReasoning(model: CodexReasoningModel, value: string) {
  efforts.value = { ...efforts.value, [model.model]: value || null }
  try {
    applyStatus(await setCodexReasoningEffort(model.model, value || null))
  } catch (cause) {
    errorText.value = codexErrorMessage(errorCode(cause), cause instanceof Error ? cause.message : undefined)
  }
}
</script>

<template>
  <section class="codex-oauth-card">
    <div class="codex-oauth-head">
      <LegacyIcon name="shield" :size="20" class="codex-oauth-icon" />
      <div class="codex-oauth-body">
        <p class="codex-oauth-title">OpenAI Codex 登录</p>
        <p class="codex-oauth-sub">使用独立的 Codex 凭据，与普通 API Key 配置隔离。</p>
        <p class="codex-oauth-sub">该连接绑定当前登录用户，不与其他使用者共享。</p>
        <p v-if="!connected" class="codex-oauth-sub">OAuth 回调仅在本机浏览器可用，远程访问请按下方 SSH 指引操作。</p>
        <p class="codex-oauth-experimental">实验性功能。</p>
        <p v-if="statusText" class="codex-oauth-status" :class="{ 'is-error': !!errorText }">{{ statusText }}</p>
        <p v-if="connected && status?.model_count !== undefined" class="codex-oauth-sub">已导入 {{ status.model_count }} 个模型。</p>

        <div v-if="connected && status && status.models.length" class="codex-reasoning">
          <p class="codex-reasoning-title">推理强度</p>
          <p class="codex-oauth-sub">为每个 Codex 模型单独选择推理强度，留空跟随提供方默认。</p>
          <label v-for="model in status.models" :key="model.model" class="codex-reasoning-row">
            <span class="codex-reasoning-name">{{ model.name }}</span>
            <select :value="model.model in efforts ? (efforts[model.model] || '') : (model.reasoning_effort || '')"
                    :disabled="pending" aria-label="推理强度"
                    @change="changeReasoning(model, ($event.target as HTMLSelectElement).value)">
              <option v-for="option in reasoningOptions(model)" :key="option.value || 'auto'" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
        </div>

        <div v-if="polling && remoteGuidance" class="codex-remote">
          <p class="codex-reasoning-title">远程访问登录指引</p>
          <ol class="codex-remote-steps">
            <li>在能访问本机的终端建立 SSH 端口转发：<code>{{ sshCommand }}</code>
              <button type="button" class="codex-link-btn" @click="copyCommand">复制命令</button>
            </li>
            <li><button type="button" class="codex-link-btn" @click="openAuthorization">打开授权页面</button>（{{ Math.round(remoteGuidance.expires_in / 60) }} 分钟内有效）</li>
            <li><button type="button" class="codex-link-btn" :disabled="pending" @click="cancel">取消登录</button></li>
          </ol>
          <div class="codex-callback-recovery">
            <p class="codex-reasoning-title">回调恢复（Docker / 无隧道）</p>
            <p class="codex-oauth-sub">若浏览器停在无法访问的回调页，把地址栏完整 URL 粘贴到这里完成登录。</p>
            <input v-model="callbackUrl" type="text" class="codex-callback-input" placeholder="http://127.0.0.1:..." aria-label="回调地址">
            <button type="button" class="codex-action-btn" :disabled="pending || !callbackUrl.trim()" @click="submitCallbackUrl">完成登录</button>
          </div>
        </div>

        <div v-if="polling && !remoteAccess" class="codex-callback-recovery">
          <p class="codex-reasoning-title">回调恢复</p>
          <p class="codex-oauth-sub">若授权后没有自动跳转，粘贴回调地址完成登录。</p>
          <input v-model="callbackUrl" type="text" class="codex-callback-input" placeholder="http://127.0.0.1:..." aria-label="回调地址">
          <button type="button" class="codex-action-btn" :disabled="pending || !callbackUrl.trim()" @click="submitCallbackUrl">完成登录</button>
        </div>

        <div class="codex-actions">
          <button v-if="!connected && !polling" type="button" class="codex-action-btn primary" :disabled="pending" @click="signIn">
            <LegacyIcon name="settings" :size="14" />{{ pending ? '处理中…' : '登录 Codex' }}
          </button>
          <button v-if="polling" type="button" class="codex-action-btn" :disabled="pending" @click="cancel">取消登录</button>
          <button v-if="connected" type="button" class="codex-action-btn" :disabled="pending" @click="refreshModels">
            <LegacyIcon name="activity" :size="14" />刷新模型
          </button>
          <button v-if="connected" type="button" class="codex-action-btn danger" :disabled="pending" @click="logout">
            <LegacyIcon name="close" :size="14" />退出登录
          </button>
        </div>
        <p v-if="callbackPort !== null && polling" class="codex-oauth-sub">本地回调端口：{{ callbackPort }}</p>
      </div>
    </div>
  </section>
</template>
