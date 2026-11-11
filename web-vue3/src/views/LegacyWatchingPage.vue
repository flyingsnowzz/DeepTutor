<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api'
import { sessionNavigationPath, type SessionNavigationTarget } from '../sessionNavigation'

const route = useRoute()
const router = useRouter()
const error = ref('')
const loading = ref(true)
let controller: AbortController | undefined

async function migrate(id: string) {
  controller?.abort()
  controller = new AbortController()
  loading.value = true
  error.value = ''
  try {
    const session = await api<SessionNavigationTarget>(`/api/sessions/${encodeURIComponent(id)}/migrate-watching`, {
      method: 'POST',
      signal: controller.signal,
    })
    if (id !== String(route.params.sessionId || '')) return
    await router.replace(sessionNavigationPath(session))
  } catch (cause) {
    if (controller.signal.aborted) return
    error.value = cause instanceof Error ? cause.message : '旧视频会话加载失败'
  } finally {
    if (id === String(route.params.sessionId || '')) loading.value = false
  }
}

watch(() => route.params.sessionId, id => { void migrate(String(id || '')) }, { immediate: true })
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <main class="feature-page legacy-watching-page">
    <p v-if="loading" role="status">正在迁移旧视频会话…</p>
    <p v-else-if="error" class="error" role="alert">
      {{ error }}
      <button type="button" @click="migrate(String(route.params.sessionId || ''))">重试</button>
    </p>
  </main>
</template>
