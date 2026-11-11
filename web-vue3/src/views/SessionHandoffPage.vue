<script setup lang="ts">
import { ref } from 'vue'
import { post } from '../api'
import LegacyIcon from '../components/LegacyIcon.vue'

interface Handoff { code: string; handoff_url: string; expires_in: number }
const origin = ref('https://')
const handoff = ref<Handoff | null>(null)
const loading = ref(false)
const copied = ref(false)
const error = ref('')
async function create() {
  loading.value = true; error.value = ''; copied.value = false; handoff.value = null
  try { handoff.value = await post<Handoff>('/api/auth/session-handoff', { public_origin: origin.value.trim() }) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '创建链接失败' }
  finally { loading.value = false }
}
async function copy() {
  if (!handoff.value) return
  try { await navigator.clipboard.writeText(handoff.value.handoff_url); copied.value = true }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '复制失败' }
}
</script>

<template>
  <main class="session-handoff-page"><div class="session-handoff-container"><RouterLink to="/profile" class="session-handoff-back"><LegacyIcon name="chevronLeft" :size="16" />返回</RouterLink><div class="session-handoff-card"><div class="handoff-title"><LegacyIcon name="key" :size="18" /><h1>公共设备登录</h1></div><form class="session-handoff-form" @submit.prevent="create"><label for="public-origin">公共 HTTPS 地址</label><div><input id="public-origin" v-model="origin" type="url" required inputmode="url" autocomplete="url" spellcheck="false"><button class="primary" :disabled="loading"><LegacyIcon name="network" :size="14" />{{ loading ? '正在创建…' : '创建链接' }}</button></div></form><p v-if="error" class="error" role="alert">{{ error }}</p><div v-if="handoff" class="session-handoff-result"><div><code>{{ handoff.code }}</code><button type="button" @click="copy"><LegacyIcon name="document" :size="14" />{{ copied ? '已复制' : '复制链接' }}</button></div><p class="handoff-url">{{ handoff.handoff_url }}</p><small>{{ handoff.expires_in }} 秒后过期</small></div></div></div></main>
</template>
