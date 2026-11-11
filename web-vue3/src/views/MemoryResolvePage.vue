<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, ApiError } from '../api'

interface Resolved { layer: string; key: string; entry_id: string }
const route = useRoute()
const router = useRouter()
const error = ref('')
const loading = ref(true)
let controller: AbortController | undefined
let requestVersion = 0

async function resolveEntry(id: string) {
  const version = ++requestVersion
  controller?.abort()
  controller = new AbortController()
  error.value = ''
  if (!id) {
    loading.value = false
    error.value = '地址中缺少 id 参数'
    return
  }
  loading.value = true
  try {
    const item = await api<Resolved>(`/api/memory/resolve_entry/${encodeURIComponent(id)}`, { signal: controller.signal })
    if (version !== requestVersion) return
    await router.replace({
      path: `/memory/${item.layer.toLowerCase()}/${encodeURIComponent(item.key)}`,
      query: { focus: item.entry_id },
    })
  } catch (cause) {
    if (version !== requestVersion || controller.signal.aborted) return
    error.value = cause instanceof ApiError && cause.status === 404
      ? `未找到记忆条目 ${id}，它可能已被删除。`
      : cause instanceof Error ? cause.message : '记忆条目解析失败'
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

watch(() => route.query.id, id => { void resolveEntry(String(id || '')) }, { immediate: true })
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <main class="feature-page memory-resolve">
    <p v-if="loading" role="status">正在查找记忆条目…</p>
    <div v-else-if="error" role="alert">
      <p>{{ error }}</p>
      <RouterLink to="/memory">返回记忆</RouterLink>
    </div>
  </main>
</template>
