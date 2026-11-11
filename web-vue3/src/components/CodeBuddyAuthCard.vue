<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LegacyIcon from './LegacyIcon.vue'
import {
  cancelCodeBuddyLogin,
  getCodeBuddyStatus,
  logoutCodeBuddy,
  shouldPollCodeBuddyAuth,
  startCodeBuddyLogin,
  type CodeBuddyAuthStatus,
} from '../providerAuth'

/** Vue3 port of web/components/settings/CodeBuddyAuthCard.tsx. */
const emit = defineEmits<{ catalogChanged: [] }>()
const status = ref<CodeBuddyAuthStatus | null>(null)
const loading = ref(true)
const working = ref(false)
const requestError = ref('')
let pollTimer: number | null = null

async function refresh() {
  try {
    requestError.value = ''
    status.value = await getCodeBuddyStatus()
  } catch (cause) {
    requestError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

function schedulePoll() {
  if (pollTimer !== null) { window.clearInterval(pollTimer); pollTimer = null }
  if (status.value && shouldPollCodeBuddyAuth(status.value)) {
    pollTimer = window.setInterval(refresh, 1000)
  }
}

onMounted(refresh)
onBeforeUnmount(() => { if (pollTimer !== null) window.clearInterval(pollTimer) })
watch(status, schedulePoll)

async function startLogin() {
  working.value = true
  requestError.value = ''
  const popup = window.open('about:blank', '_blank')
  try {
    const next = await startCodeBuddyLogin()
    status.value = next
    if (next.authorize_url) {
      if (popup) popup.location.href = next.authorize_url
    } else {
      popup?.close()
    }
  } catch (cause) {
    popup?.close()
    requestError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    working.value = false
  }
}

async function cancelLogin() {
  working.value = true
  try {
    status.value = await cancelCodeBuddyLogin()
  } catch (cause) {
    requestError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    working.value = false
  }
}

async function logout() {
  working.value = true
  requestError.value = ''
  try {
    status.value = await logoutCodeBuddy()
    emit('catalogChanged')
  } catch (cause) {
    requestError.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    working.value = false
  }
}

const connected = () => status.value?.connection === 'connected'
const waiting = () => status.value?.operation_state === 'waiting'
</script>

<template>
  <section class="codex-oauth-card codebuddy-card">
    <div class="codex-oauth-head">
      <LegacyIcon name="key" :size="20" class="codex-oauth-icon" />
      <div class="codex-oauth-body">
        <p class="codex-oauth-title">CodeBuddy 登录</p>
        <p class="codex-oauth-sub">使用 CodeBuddy 账号授权，由提供方托管模型访问。</p>
        <p v-if="loading" class="codex-oauth-sub">正在读取连接状态…</p>
        <p v-else-if="requestError" class="codex-oauth-status is-error">{{ requestError }}</p>
        <p v-else-if="status" class="codex-oauth-status" :class="{ 'is-ok': connected() }">
          <template v-if="waiting()">等待浏览器完成授权…</template>
          <template v-else-if="connected()">已连接<template v-if="status.user_label">：{{ status.user_label }}</template></template>
          <template v-else-if="status.operation_state === 'cancelled'">登录已取消。</template>
          <template v-else-if="status.operation_state === 'failed'">登录失败，请重试。</template>
          <template v-else>尚未连接。</template>
        </p>
        <div class="codex-actions">
          <button v-if="!connected() && !waiting()" type="button" class="codex-action-btn primary" :disabled="working" @click="startLogin">
            <LegacyIcon name="settings" :size="14" />{{ working ? '处理中…' : '登录 CodeBuddy' }}
          </button>
          <button v-if="waiting()" type="button" class="codex-action-btn" :disabled="working" @click="cancelLogin">取消登录</button>
          <button v-if="connected()" type="button" class="codex-action-btn danger" :disabled="working" @click="logout">
            <LegacyIcon name="close" :size="14" />退出登录
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
