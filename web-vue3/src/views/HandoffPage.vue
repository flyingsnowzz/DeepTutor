<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { post } from '../api'
import LegacyIcon from '../components/LegacyIcon.vue'

const router = useRouter()
const code = ref('')
const busy = ref(false)
const error = ref('')
const initial = new URLSearchParams(window.location.search)
const suppliedCode = initial.get('code')?.trim() || ''
const requestedNext = initial.get('next') || '/chat'
function safeNext(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return '/chat'
  try {
    const parsed = new URL(value, 'https://deeptutor.invalid')
    const decoded = decodeURIComponent(parsed.pathname)
    return parsed.origin === 'https://deeptutor.invalid' && !decoded.startsWith('//') && !decoded.includes('\\') && !/[\u0000-\u001f\u007f]/.test(decoded)
      ? `${parsed.pathname}${parsed.search}${parsed.hash}` : '/chat'
  } catch { return '/chat' }
}
const next = safeNext(requestedNext)
async function complete(value: string) {
  if (!value.trim() || busy.value) return
  busy.value = true; error.value = ''
  try {
    const result = await post<{ ticket: string }>('/api/auth/session-handoff/exchange', { code: value.trim() })
    await post('/api/auth/session-handoff/complete', { ticket: result.ticket })
    await router.replace(next)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '配对失败'; busy.value = false }
}
onMounted(() => {
  window.history.replaceState(null, '', window.location.pathname)
  if (suppliedCode) void complete(suppliedCode)
})
</script>

<template>
  <main class="handoff-page"><div class="handoff-card"><div class="handoff-title"><LegacyIcon name="key" :size="18" /><h1>公共设备登录</h1></div><p v-if="busy" role="status">正在完成登录…</p><form v-else class="handoff-form" @submit.prevent="complete(code)"><label for="handoff-code">配对码<input id="handoff-code" v-model="code" autocomplete="one-time-code" required spellcheck="false"></label><button class="primary">继续</button></form><p v-if="error" class="error" role="alert">{{ error }}</p></div></main>
</template>
